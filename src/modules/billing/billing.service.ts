import crypto from 'crypto';
import { AppError } from '../../middlewares/error-handler';
import { prisma } from '../../database/db';
import NotificationService from '../notifications/notification.service';
import { publishAdminAlert } from '../../realtime/notification-gateway';
import { BillingRepository } from './billing.repository';
import { PaymentProviderClient } from './payment.provider';

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
        fullName: t.fullName || (t.user ? `${t.user.firstName || ''} ${t.user.lastName || ''}`.trim() : 'ไม่ระบุชื่อ'),
        studentId: t.studentId,
        phone: t.phone,
        email: t.email || t.user?.email,
      })),
    };
  }

  static async generateRoomBills(data: GenerateRoomBillInput) {
    const room = await BillingRepository.findRoomByNumberWithTenants(data.roomNumber);
    if (!room) {
      throw new AppError(`ไม่พบข้อมูลห้องพักเลขที่ ${data.roomNumber}`, 404);
    }

    const tenants = room.tenants;
    if (!tenants || tenants.length === 0) {
      throw new AppError(
        `ห้อง ${room.roomNumber} ยังไม่มีผู้พักอาศัยที่ลงทะเบียนในระบบ ไม่สามารถสร้างบิลและหารค่าใช้จ่ายได้`,
        400
      );
    }

    // 1. คำนวณค่าไฟ (อัตราคงที่ 8 บาท/หน่วย ตามสัญญา)
    const electricRate = data.electricRate !== undefined ? Number(data.electricRate) : 8;
    const electricUnits = Math.max(0, Number(data.electricUnits || 0));
    const electricTotal = electricUnits * electricRate;

    // 2. คำนวณค่าน้ำ (อัตราเหมาจ่ายคงที่ 100 บาท/ห้อง ตามสัญญา)
    const waterTotal = data.waterAmount !== undefined ? Number(data.waterAmount) : 100;

    // 3. ค่าเช่าห้อง
    const rentTotal = data.customRent !== undefined ? Number(data.customRent) : Number(room.monthlyRent);

    // 4. ยอดรวมทั้งห้อง
    const grandTotal = rentTotal + electricTotal + waterTotal;

    // 5. หารตามจำนวนผู้พักอาศัยจริงในห้อง (เพื่อป้องกันเงินตกหล่น)
    const tenantCount = tenants.length;
    const amountPerTenant = Math.round((grandTotal / tenantCount) * 100) / 100;

    // วันครบกำหนดชำระ
    const dueDate = data.dueDate ? new Date(data.dueDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const billingMonth = data.billingMonth || new Date().toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });

    const description = `ค่าห้องพักประจำเดือน ${billingMonth} (ค่าเช่า ฿${rentTotal.toLocaleString('th-TH')} + ค่าไฟ ${electricUnits} หน่วย @${electricRate}บ. ฿${electricTotal.toLocaleString('th-TH')} + ค่าน้ำ ฿${waterTotal.toLocaleString('th-TH')} รวม ฿${grandTotal.toLocaleString('th-TH')} หาร ${tenantCount} คน)`;

    const billsPayload = tenants.map((tenant) => ({
      tenantId: tenant.id,
      roomId: room.id,
      amount: amountPerTenant,
      rentAmount: Math.round((rentTotal / tenantCount) * 100) / 100,
      electricAmount: Math.round((electricTotal / tenantCount) * 100) / 100,
      waterAmount: Math.round((waterTotal / tenantCount) * 100) / 100,
      penaltyAmount: 0,
      dueDate,
      description,
    }));

    const createdBills = await BillingRepository.createBills(billsPayload);

    return {
      roomNumber: room.roomNumber,
      roomId: room.id,
      calculation: {
        currency: 'THB',
        rentTotal,
        electricUnits,
        electricRate,
        electricTotal,
        waterTotal,
        grandTotal,
        tenantCount,
        amountPerTenant,
        billingMonth,
        dueDate,
      },
      tenants: tenants.map((t) => ({
        id: t.id,
        fullName: t.fullName || (t.user ? `${t.user.firstName || ''} ${t.user.lastName || ''}`.trim() : 'ไม่ระบุชื่อ'),
        studentId: t.studentId,
      })),
      createdBills,
    };
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
      && amountMatches;
    const failureReason = verification.duplicate
      ? 'Duplicate slip'
      : !verification.recipientMatched
        ? 'Recipient account does not match'
        : !amountMatches
          ? 'Payment amount does not match bill amount'
          : verification.message;

    const result = await prisma.$transaction(async (transaction) => {
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
          failureReason: verified ? null : failureReason,
          verifiedAt: verified ? new Date() : null,
        },
      });

      return { billStatus: verified ? 'PAID' : 'FAILED', payment: updatedPayment };
    });

    publishAdminAlert(
      billId,
      'PAYMENT_SLIP',
      result.billStatus === 'PAID' ? `ตรวจสลิปบิล #${billId}: ชำระเงินแล้ว` : `ตรวจสลิปบิล #${billId}: ไม่ผ่าน (${failureReason})`,
      result.billStatus,
    );

    return result;
  }

  static async updateBillStatus(billId: number, status: string, reason?: string) {
    const existing = await BillingRepository.findBillById(billId);
    if (!existing) {
      throw new AppError('Bill not found', 404);
    }

    const dataToUpdate: any = {
      status: status as any,
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

