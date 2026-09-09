import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { AppError } from '../../middlewares/error-handler';
import { prisma } from '../../database/db';
import { PaymentProviderClient } from './payment.provider';

const getAccountDetails = () => {
  const bankName = process.env.PAYMENT_BANK_NAME?.trim();
  const accountName = process.env.PAYMENT_ACCOUNT_NAME?.trim();
  const accountNumber = process.env.PAYMENT_ACCOUNT_NUMBER?.trim();
  const promptPayNumber = process.env.PAYMENT_PROMPTPAY_NUMBER?.trim();

  if (!bankName || !accountName || !accountNumber || !promptPayNumber) {
    throw new AppError('Payment account details are not configured', 500);
  }

  return { bankName, accountName, accountNumber, promptPayNumber };
};

const paymentSlipRoot = path.join(
  path.resolve(process.env.UPLOAD_ROOT || path.join(process.cwd(), 'uploads/private')),
  'payment-slips',
);

const savePrivateSlip = async (file: { buffer: Buffer; mimetype: string }): Promise<string> => {
  const extension = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
  const now = new Date();
  const directory = path.join(paymentSlipRoot, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
  const absolutePath = path.join(directory, `${crypto.randomUUID()}.${extension}`);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(absolutePath, file.buffer, { mode: 0o600 });
  return path.relative(process.cwd(), absolutePath).replace(/\\/g, '/');
};

const findNestedValue = (value: unknown, keys: string[]): unknown => {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  for (const child of Object.values(record)) {
    const found = findNestedValue(child, keys);
    if (found !== undefined) return found;
  }
  return undefined;
};

const parseTransferAt = (rawData: unknown): Date | null => {
  const value = findNestedValue(rawData, ['transferAt', 'transferredAt', 'transferDate', 'transactionDate', 'date', 'time']);
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseProviderReference = (rawData: unknown): string | undefined => {
  const value = findNestedValue(rawData, ['providerTransactionId', 'transactionId', 'referenceNumber', 'reference', 'transRef']);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const includeBatchDetails = {
  items: {
    include: {
      bill: {
        select: {
          id: true,
          amount: true,
          rentAmount: true,
          electricAmount: true,
          waterAmount: true,
          penaltyAmount: true,
          dueDate: true,
          status: true,
          description: true,
        },
      },
    },
  },
} as const;

const toBatchResponse = (batch: any) => ({
  id: batch.id,
  amount: Number(batch.amount),
  status: batch.status,
  createdAt: batch.createdAt,
  updatedAt: batch.updatedAt,
  account: getAccountDetails(),
  items: batch.items.map((item: any) => ({
    billId: item.billId,
    amount: Number(item.amount),
    bill: {
      ...item.bill,
      amount: Number(item.bill.amount),
      rentAmount: Number(item.bill.rentAmount),
      electricAmount: Number(item.bill.electricAmount),
      waterAmount: Number(item.bill.waterAmount),
      penaltyAmount: Number(item.bill.penaltyAmount),
    },
  })),
});

export class PaymentBatchService {
  static async create(userId: number, billIds: number[], idempotencyKey: string) {
    const uniqueBillIds = [...new Set(billIds)];
    if (uniqueBillIds.length === 0 || uniqueBillIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw new AppError('billIds must contain positive integer ids', 400);
    }

    const existing = await prisma.paymentBatch.findUnique({ where: { idempotencyKey } });
    if (existing) {
      const batch = await prisma.paymentBatch.findUnique({
        where: { id: existing.id },
        include: includeBatchDetails,
      });
      return toBatchResponse(batch);
    }

    const bills = await prisma.bill.findMany({
      where: {
        id: { in: uniqueBillIds },
        tenant: { userId },
      },
      include: { tenant: true },
    });

    if (bills.length !== uniqueBillIds.length) {
      throw new AppError('One or more bills were not found for this user', 404);
    }

    if (bills.some((bill) => bill.status !== 'UNPAID' && bill.status !== 'OVERDUE')) {
      throw new AppError('One or more bills cannot be paid', 409);
    }

    const total = bills.reduce((sum, bill) => sum + Number(bill.amount), 0);
    const batch = await prisma.paymentBatch.create({
      data: {
        payerUserId: userId,
        amount: total,
        status: 'PENDING',
        idempotencyKey,
        items: {
          create: bills.map((bill) => ({
            billId: bill.id,
            amount: bill.amount,
          })),
        },
      },
      include: includeBatchDetails,
    });

    return toBatchResponse(batch);
  }

  static async getById(batchId: number, userId: number) {
    const batch = await prisma.paymentBatch.findFirst({
      where: { id: batchId, payerUserId: userId },
      include: includeBatchDetails,
    });

    if (!batch) {
      throw new AppError('Payment batch not found', 404);
    }

    return toBatchResponse(batch);
  }

  static async generateQr(batchId: number, userId: number) {
    const batch = await prisma.paymentBatch.findFirst({
      where: { id: batchId, payerUserId: userId },
      select: { id: true, amount: true, status: true },
    });

    if (!batch) {
      throw new AppError('Payment batch not found', 404);
    }

    if (batch.status !== 'PENDING' && batch.status !== 'FAILED') {
      throw new AppError('This payment batch cannot generate a QR code', 409);
    }

    try {
      return await PaymentProviderClient.generateQr(Number(batch.amount));
    } catch (error) {
      // A batch is only usable after QR generation succeeds. Remove the pending
      // placeholder so failed preparation cannot appear as a payment attempt.
      await prisma.paymentBatch.deleteMany({
        where: {
          id: batchId,
          payerUserId: userId,
          status: 'PENDING',
          slipHash: null,
        },
      });
      throw error;
    }
  }

  static async uploadSlip(
    batchId: number,
    userId: number,
    file: { buffer: Buffer; mimetype: string; originalname: string },
  ) {
    const slipHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const slipPath = await savePrivateSlip(file);
    const batch = await prisma.paymentBatch.findFirst({
      where: { id: batchId, payerUserId: userId },
      include: { items: { include: { bill: true } } },
    });

    if (!batch) {
      throw new AppError('Payment batch not found', 404);
    }

    if (batch.status !== 'PENDING' && batch.status !== 'FAILED') {
      throw new AppError('This payment batch cannot receive a slip', 409);
    }

    const duplicate = await prisma.paymentBatch.findFirst({
      where: { slipHash, id: { not: batchId } },
      select: { id: true },
    });
    if (duplicate) {
      throw new AppError('This slip has already been submitted', 409);
    }

    await prisma.$transaction(async (transaction) => {
      const claimedBatch = await transaction.paymentBatch.updateMany({
        where: { id: batchId, payerUserId: userId, status: batch.status },
        data: { status: 'VERIFYING', slipHash, slipPath, failureReason: null },
      });
      if (claimedBatch.count !== 1) {
        throw new AppError('Payment batch is being processed by another request', 409);
      }

      for (const item of batch.items) {
        const updatedBill = await transaction.bill.updateMany({
          where: {
            id: item.billId,
            version: item.bill.version,
            status: item.bill.status,
          },
          data: {
            status: 'VERIFYING',
            slipHash,
            reason: 'Payment batch verification pending',
            version: { increment: 1 },
          },
        });
        if (updatedBill.count !== 1) {
          throw new AppError('One or more bills changed before verification', 409);
        }
      }
    });

    let verification;
    try {
      verification = await PaymentProviderClient.verifySlip(file);
    } catch (error) {
      await prisma.paymentBatch.update({
        where: { id: batchId },
        data: {
          status: 'MANUAL_REVIEW',
          failureReason: error instanceof Error ? error.message : 'Payment provider request failed',
        },
      });
      throw error;
    }

    const amountMatches = verification.amount !== null && verification.amount === Number(batch.amount);
    const verified = verification.success
      && verification.recipientMatched
      && !verification.duplicate
      && amountMatches;
    const failureReason = verification.duplicate
      ? 'Duplicate slip'
      : !verification.recipientMatched
        ? 'Recipient account does not match'
        : !amountMatches
          ? 'Payment amount does not match payment batch'
          : verification.message;

    await prisma.$transaction(async (transaction) => {
      const current = await transaction.paymentBatch.findUnique({
        where: { id: batchId },
        include: { items: true },
      });
      if (!current || current.status !== 'VERIFYING') {
        throw new AppError('Payment batch verification state changed unexpectedly', 409);
      }

      const updatedBatch = await transaction.paymentBatch.updateMany({
        where: { id: batchId, status: 'VERIFYING' },
        data: {
          status: verified ? 'PAID' : 'FAILED',
          slipAmount: verification.amount,
          transferAt: parseTransferAt(verification.rawData),
          providerTransactionId: parseProviderReference(verification.rawData),
          providerResponse: JSON.stringify(verification.rawData),
          failureReason: verified ? null : failureReason,
          verifiedAt: verified ? new Date() : null,
        },
      });
      if (updatedBatch.count !== 1) {
        throw new AppError('Payment batch was updated by another request', 409);
      }

      for (const item of current.items) {
        await transaction.bill.updateMany({
          where: { id: item.billId, status: 'VERIFYING' },
          data: {
            status: verified ? 'PAID' : 'FAILED',
            paidAt: verified ? new Date() : null,
            reason: verified ? 'Payment batch verified' : failureReason,
            version: { increment: 1 },
          },
        });
      }
    });

    return this.getById(batchId, userId);
  }

  static async getAdminBillPaymentDetails(billId: number) {
    const bill = await prisma.bill.findUnique({
      where: { id: billId },
      include: {
        tenant: { include: { user: true } },
        payments: { orderBy: { createdAt: 'desc' } },
        batchItems: {
          where: {
            batch: {
              OR: [
                { status: { not: 'PENDING' } },
                { slipPath: { not: null } },
              ],
            },
          },
          include: { batch: true },
          orderBy: { batch: { createdAt: 'desc' } },
        },
      },
    });

    if (!bill) throw new AppError('Bill not found', 404);
    const parseProviderResponse = (value: string | null) => {
      if (!value) return null;
      try { return JSON.parse(value); } catch { return null; }
    };

    return {
      bill,
      payments: bill.payments.map((payment) => ({
        ...payment,
        amount: Number(payment.amount),
        slipAmount: payment.slipAmount === null ? null : Number(payment.slipAmount),
        providerResponse: parseProviderResponse(payment.providerResponse),
      })),
      batches: bill.batchItems.map(({ batch }) => ({
        ...batch,
        amount: Number(batch.amount),
        slipAmount: batch.slipAmount === null ? null : Number(batch.slipAmount),
        providerResponse: parseProviderResponse(batch.providerResponse),
      })),
    };
  }

  static async getAdminBillSlipFile(billId: number) {
    const details = await this.getAdminBillPaymentDetails(billId);
    const payment = details.payments.find((item) => item.slipPath);
    const batch = details.batches.find((item) => item.slipPath);
    const slipPath = payment?.slipPath ?? batch?.slipPath;
    if (!slipPath) throw new AppError('Payment slip not found', 404);

    const absolutePath = path.resolve(process.cwd(), slipPath);
    if (!absolutePath.startsWith(`${paymentSlipRoot}${path.sep}`)) {
      throw new AppError('Invalid private payment slip path', 500);
    }
    return absolutePath;
  }
}
