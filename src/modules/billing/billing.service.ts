import { assertSlipAvailable } from './payment-slip-guard';
import type { Prisma, BillStatus } from '@prisma/client';
import crypto from 'crypto';
import { AppError } from '../../middlewares/error-handler';
import { prisma } from '../../database/db';
import NotificationService from '../notifications/notification.service';
import { publishAdminAlert } from '../../realtime/notification-gateway';
import { BillingRepository } from './billing.repository';
import { PaymentProviderClient } from './payment.provider';
import { acquireLock, releaseLock } from '../../shared/redis';
import { getSettingValue } from '../settings/settings.service';

export interface GenerateRoomBillInput {
  roomNumber: string;
  electricUnits: number;
  electricRate?: number;
  waterAmount?: number;
  dueDate: string | Date;
  billingMonth?: string;
  customRent?: number;
}

interface PaymentSlipFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

export class BillingService {
  static async listBills(userId?: number, role?: string) {
    return BillingRepository.listBills(userId, role);
  }

  static async getBillById(id: number) {
    return BillingRepository.findBillById(id);
  }

  static async getBillingReport(from?: Date, to?: Date) {
    const bills = await prisma.bill.findMany({
      where: {
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      select: { amount: true, status: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const summary = bills.reduce((result, bill) => {
      const amount = Number(bill.amount);
      result.totalAmount += amount;
      result.byStatus[bill.status] = (result.byStatus[bill.status] || 0) + amount;
      result.countByStatus[bill.status] = (result.countByStatus[bill.status] || 0) + 1;
      const month = bill.createdAt.toISOString().slice(0, 7);
      const monthly = result.monthly[month] || { month, amount: 0, paidAmount: 0, billCount: 0, paidCount: 0 };
      monthly.amount += amount;
      monthly.billCount += 1;
      if (bill.status === 'PAID') {
        monthly.paidAmount += amount;
        monthly.paidCount += 1;
      }
      result.monthly[month] = monthly;
      return result;
    }, {
      totalAmount: 0,
      byStatus: {} as Record<string, number>,
      countByStatus: {} as Record<string, number>,
      monthly: {} as Record<string, { month: string; amount: number; paidAmount: number; billCount: number; paidCount: number }>,
    });

    return {
      currency: 'THB',
      totalBills: bills.length,
      totalAmount: summary.totalAmount,
      paidAmount: summary.byStatus.PAID || 0,
      unpaidAmount: (summary.byStatus.UNPAID || 0) + (summary.byStatus.OVERDUE || 0),
      verifyingAmount: summary.byStatus.VERIFYING || 0,
      byStatus: summary.byStatus,
      countByStatus: summary.countByStatus,
      monthly: Object.values(summary.monthly),
    };
  }

  static async generatePaymentQr(billId: number, userId: number) {
    const bill = await BillingRepository.findBillById(billId);
    if (!bill) {
      throw new AppError('Bill not found', 404);
    }

    if (bill.tenant.userId !== userId) {
      throw new AppError('You are not allowed to pay this bill', 403);
    }

    if (bill.status !== 'UNPAID' && bill.status !== 'OVERDUE') {
      throw new AppError('This bill cannot receive a payment', 409);
    }

    return PaymentProviderClient.generateQr(Number(bill.amount));
  }

  static async getRoomBillingInfo(roomNumber: string) {
    const room = await BillingRepository.findRoomByNumberWithTenants(roomNumber);
    if (!room) {
      throw new AppError(`ไม่พบข้อมูลห้องพักเลขที่ ${roomNumber}`, 404);
    }

    return {
      id: room.id,
      roomNumber: room.roomNumber,
      floor: room.floor,
      status: room.status,
      monthlyRent: Number(room.monthlyRent),
      capacity: room.capacity,
      tenantCount: room.tenants.length,
      tenants: room.tenants.map((t) => ({
        id: t.id,
        fullName: t.fullName || t.user?.username || t.user?.email || 'ไม่ระบุชื่อ',
        studentId: t.studentId,
        phone: t.phone,
        email: t.email || t.user?.email,
      })),
    };
  }

  private static normalizeBillingPeriod(value?: string) {
    const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const text = value?.trim().replace(/[๐-๙]/g, digit => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit)));
    let year: number; let month: number;
    if (!text) {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
      year = Number(parts.find(part => part.type === 'year')!.value);
      month = Number(parts.find(part => part.type === 'month')!.value);
    } else {
      const canonical = /^(\d{4})-(\d{2})$/.exec(text);
      const thai = /^(\S+)\s+(\d{4})$/.exec(text);
      if (canonical) { year = Number(canonical[1]); month = Number(canonical[2]); }
      else if (thai && months.includes(thai[1]!)) {
        year = Number(thai[2]); if (year >= 2400) year -= 543;
        month = months.indexOf(thai[1]!) + 1;
      } else throw new AppError('กรุณาระบุรอบเดือนเป็น YYYY-MM หรือเดือนภาษาไทย เช่น ตุลาคม 2569', 400);
    }
    if (year < 1900 || year > 9999 || month < 1 || month > 12) throw new AppError('รอบเดือนเรียกเก็บไม่ถูกต้อง', 400);
    return { billingPeriod: `${year}-${String(month).padStart(2, '0')}`, billingMonth: `${months[month - 1]} ${year + 543}` };
  }

  static async generateRoomBills(data: GenerateRoomBillInput) {
    const period = this.normalizeBillingPeriod(data.billingMonth);
    const dueDate = data.dueDate ? new Date(data.dueDate) : new Date(Date.now() + 7 * 86400000);
    if (!Number.isFinite(dueDate.getTime())) throw new AppError('วันที่ครบกำหนดชำระไม่ถูกต้อง', 400);
    const cents = (value: number) => {
      if (!Number.isFinite(value) || value < 0 || value > 99999999.99) throw new AppError('ยอดเงินต้องเป็นจำนวนไม่ติดลบและไม่เกิน 99,999,999.99 บาท', 400);
      return Math.round((value + Number.EPSILON) * 100);
    };
    const electricUnits = Number(data.electricUnits);
    if (!Number.isFinite(electricUnits) || electricUnits < 0) throw new AppError('หน่วยไฟฟ้าต้องเป็นจำนวนไม่ติดลบ', 400);
    const configuredElectricRate = await getSettingValue('contractElectricityRate');
    const electricRate = data.electricRate === undefined
      ? (configuredElectricRate.trim() ? Number(configuredElectricRate) : 8)
      : Number(data.electricRate);
    cents(electricRate);
    const electricCents = cents(electricUnits * electricRate);
    const configuredWaterAmount = await getSettingValue('billingWaterAmount');
    const waterCents = cents(data.waterAmount === undefined ? Number(configuredWaterAmount) : Number(data.waterAmount));
    try {
      return await prisma.$transaction(async tx => {
        const snapshot = await BillingRepository.findRoomByNumberWithTenants(data.roomNumber, tx);
        if (!snapshot) throw new AppError(`ไม่พบข้อมูลห้องพักเลขที่ ${data.roomNumber}`, 404);
        // Match the User -> Tenant -> Room lock order used by move-out and deletion.
        const userIds = [...new Set(snapshot.tenants.map(t => t.userId!).filter(id => id !== null))].sort((a, b) => a - b);
        for (const id of userIds) await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
        for (const tenant of snapshot.tenants) await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenant.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${snapshot.id} FOR UPDATE`;
        const room = await BillingRepository.findRoomByNumberWithTenants(data.roomNumber, tx);
        if (!room || room.id !== snapshot.id || room.tenants.map(t => t.id).join(',') !== snapshot.tenants.map(t => t.id).join(',')) {
          throw new AppError('ผู้พักในห้องเปลี่ยนระหว่างออกบิล กรุณาโหลดข้อมูลใหม่', 409);
        }
        const tenants = room.tenants;
        if (!tenants.length) throw new AppError(`ห้อง ${room.roomNumber} ยังไม่มีผู้พักที่อนุมัติเข้าพัก ไม่สามารถสร้างบิลได้`, 400);
        if (await tx.bill.count({ where: { roomId: room.id, billingPeriod: period.billingPeriod } })) {
          throw new AppError(`ห้อง ${room.roomNumber} มีบิลรอบ ${period.billingMonth} แล้ว กรุณาตรวจสอบบิลเดิม`, 409);
        }
        if (await tx.bill.count({ where: { roomId: room.id, billingPeriod: null } })) {
          throw new AppError('ห้องนี้มีบิลเดิมที่ยังไม่ระบุรอบเดือน ต้องตรวจสอบรอบของบิลเดิมก่อนออกบิลใหม่', 409);
        }
        const rentCents = cents(data.customRent === undefined ? Number(room.monthlyRent) : Number(data.customRent));
        const totalCents = rentCents + electricCents + waterCents;
        cents(totalCents / 100);
        const tenantCount = tenants.length;
        // Rotate component remainders so every column sums exactly and total shares differ by <= 1 satang.
        let cursor = 0;
        const shares = [rentCents, electricCents, waterCents].map(total => {
          const base = Math.floor(total / tenantCount); const remainder = total % tenantCount;
          const values = tenants.map((_, index) => base + ((index - cursor + tenantCount) % tenantCount < remainder ? 1 : 0));
          cursor = (cursor + remainder) % tenantCount;
          return values;
        });
        const rentTotal = rentCents / 100, electricTotal = electricCents / 100, waterTotal = waterCents / 100, grandTotal = totalCents / 100;
        const description = `ค่าห้องพักประจำเดือน ${period.billingMonth} (ค่าเช่า ฿${rentTotal.toLocaleString('th-TH')} + ค่าไฟ ${electricUnits} หน่วย @${electricRate}บ. ฿${electricTotal.toLocaleString('th-TH')} + ค่าน้ำ ฿${waterTotal.toLocaleString('th-TH')} รวม ฿${grandTotal.toLocaleString('th-TH')} หาร ${tenantCount} คน)`;
        const billsPayload = tenants.map((tenant, index) => ({
          tenantId: tenant.id, roomId: room.id, billingPeriod: period.billingPeriod,
          rentAmount: shares[0]![index]! / 100, electricAmount: shares[1]![index]! / 100, waterAmount: shares[2]![index]! / 100,
          amount: (shares[0]![index]! + shares[1]![index]! + shares[2]![index]!) / 100,
          penaltyAmount: 0, dueDate, description,
        }));
        const createdBills = await BillingRepository.createBills(billsPayload, tx);
        return {
          roomNumber: room.roomNumber, roomId: room.id,
          calculation: { currency: 'THB', rentTotal, electricUnits, electricRate, electricTotal, waterTotal, grandTotal,
            tenantCount, amountPerTenant: Math.floor(totalCents / tenantCount) / 100,
            maxAmountPerTenant: Math.ceil(totalCents / tenantCount) / 100, ...period, dueDate },
          tenants: tenants.map(t => ({ id: t.id, fullName: t.fullName || t.user?.username || t.user?.email || 'ไม่ระบุชื่อ', studentId: t.studentId })),
          createdBills,
        };
      }, { timeout: 15000 });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') throw new AppError('มีบิลรอบเดือนนี้แล้ว กรุณาตรวจสอบบิลเดิม', 409);
      throw error;
    }
  }

  static async uploadSlip(billId: number, slipHash: string) {
    const bill = await BillingRepository.findBillById(billId);
    if (!bill) {
      throw new AppError('Bill not found', 404);
    }

    return BillingRepository.updateBill(billId, {
      status: 'VERIFYING',
      slipHash,
      reason: 'OCR pending',
      version: bill.version + 1,
    });
  }

  static async verifyPaymentSlip(billId: number, userId: number, idempotencyKey: string, file: PaymentSlipFile) {
    // Distributed lock: prevent double-submit across replicas
    // SET NX PX is atomic — only one replica can acquire this lock at a time
    const lockKey = `lock:payment:bill:${billId}`;
    const lockAcquired = await acquireLock(lockKey, 30_000);
    if (!lockAcquired) {
      throw new AppError('Payment is already being processed, please wait a moment and try again', 409);
    }

    try {
      const bill = await BillingRepository.findBillById(billId);
      if (!bill) {
        throw new AppError('Bill not found', 404);
      }

      if (bill.tenant.userId !== userId) {
        throw new AppError('You are not allowed to pay this bill', 403);
      }

      if (bill.status !== 'UNPAID' && bill.status !== 'OVERDUE') {
        throw new AppError('This bill cannot receive a payment', 409);
      }

      const slipHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
      const existingPayment = await prisma.payment.findFirst({
        where: {
          OR: [{ idempotencyKey }, { slipHash }],
        },
      });

      if (existingPayment) {
        throw new AppError('This payment has already been submitted', 409);
      }

      const payment = await prisma.$transaction(async (transaction) => {
        await assertSlipAvailable(transaction, slipHash);
        const updatedBill = await transaction.bill.updateMany({
          where: {
            id: billId,
            version: bill.version,
            status: bill.status,
          },
          data: {
            status: 'VERIFYING',
            slipHash,
            reason: 'Payment provider verification pending',
            version: { increment: 1 },
          },
        });

        if (updatedBill.count !== 1) {
          throw new AppError('Bill was updated by another request', 409);
        }

        return transaction.payment.create({
          data: {
            billId,
            payerUserId: userId,
            amount: bill.amount,
            status: 'VERIFYING',
            idempotencyKey,
            slipHash,
          },
        });
      });

      let verification;
      try {
        verification = await PaymentProviderClient.verifySlip(file);
      } catch (error) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'MANUAL_REVIEW',
            failureReason: error instanceof Error ? error.message : 'Payment provider request failed',
          },
        });
        throw error;
      }

      const expectedAmount = Number(bill.amount);
      const amountMatches = verification.amount !== null && verification.amount === expectedAmount;
      const verified = verification.success
        && verification.recipientMatched
        && !verification.duplicate
        && amountMatches
        && Boolean(verification.transactionId);
      const failureReason = verification.duplicate
        ? 'Duplicate slip'
        : !verification.recipientMatched
          ? 'Recipient account does not match'
          : !amountMatches
            ? 'Payment amount does not match bill amount'
            : !verification.transactionId ? 'Missing transaction reference' : verification.message;

      const result = await prisma.$transaction(async (transaction) => {
        await assertSlipAvailable(transaction, slipHash, verification.transactionId, { paymentId: payment.id });
        const currentBill = await transaction.bill.findUnique({ where: { id: billId } });
        if (!currentBill || currentBill.status !== 'VERIFYING') {
          throw new AppError('Bill verification state changed unexpectedly', 409);
        }

        const updatedBill = await transaction.bill.updateMany({
          where: { id: billId, version: currentBill.version, status: 'VERIFYING' },
          data: {
            status: verified ? 'PAID' : 'FAILED',
            paidAt: verified ? new Date() : null,
            reason: verified ? 'Payment verified' : failureReason,
            version: { increment: 1 },
          },
        });

        if (updatedBill.count !== 1) {
          throw new AppError('Bill was updated by another request', 409);
        }

        const updatedPayment = await transaction.payment.update({
          where: { id: payment.id },
          data: {
            status: verified ? 'PAID' : 'FAILED',
            providerResponse: JSON.stringify(verification.rawData),
            providerTransactionId: verification.transactionId,
            slipAmount: verification.amount,
            failureReason: verified ? null : failureReason,
            verifiedAt: verified ? new Date() : null,
          },
        });

        return { billStatus: verified ? 'PAID' : 'FAILED', payment: updatedPayment };
      }).catch(async (error: unknown) => {
        const duplicate = error instanceof AppError && error.statusCode === 409;
        await prisma.$transaction(async (tx) => {
          await tx.payment.updateMany({ where: { id: payment.id, status: 'VERIFYING' }, data: {
            status: duplicate ? 'FAILED' : 'MANUAL_REVIEW', failureReason: 'PAYMENT_FINALIZATION_FAILED',
          } });
          if (duplicate) await tx.bill.updateMany({ where: { id: billId, status: 'VERIFYING', slipHash }, data: {
            status: 'FAILED', reason: 'Duplicate transaction', version: { increment: 1 },
          } });
        });
        throw error;
      });

      publishAdminAlert(
        billId,
        'PAYMENT_SLIP',
        result.billStatus === 'PAID' ? `ตรวจสลิปบิล #${billId}: ชำระเงินแล้ว` : `ตรวจสลิปบิล #${billId}: ไม่ผ่าน (${failureReason})`,
        result.billStatus,
      );

      return result;
    } finally {
      // Always release lock — even if an error was thrown
      await releaseLock(lockKey);
    }
  }

  static async updateBillStatus(billId: number, status: string, reason?: string) {
    const existing = await BillingRepository.findBillById(billId);
    if (!existing) {
      throw new AppError('Bill not found', 404);
    }

    const dataToUpdate: Prisma.BillUpdateInput = {
      status: status as BillStatus,
      reason,
      version: { increment: 1 },
    };

    if (status === 'PAID') {
      dataToUpdate.paidAt = new Date();
    } else if (status === 'UNPAID') {
      dataToUpdate.paidAt = null;
    }

    const updated = await BillingRepository.updateBill(billId, dataToUpdate);

    if (status === 'OVERDUE') {
      const notificationService = new NotificationService();
      await notificationService.scheduleNotification({
        tenantId: updated.tenantId,
        channel: 'SMS',
        type: 'RENT_OVERDUE',
        payload: JSON.stringify({ message: `Bill ${updated.id} is overdue`, amount: updated.amount.toString() }),
      });
    }

    return updated;
  }

  static async deleteBill(billId: number) {
    const bill = await BillingRepository.findBillById(billId);
    if (!bill) {
      throw new AppError('Bill not found', 404);
    }

    return BillingRepository.deleteBill(billId);
  }
}

