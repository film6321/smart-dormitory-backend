import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../database/db';
import { AppError } from '../../middlewares/error-handler';
import { PaymentProviderClient } from '../billing/payment.provider';
import { assertSlipAvailable } from '../billing/payment-slip-guard';
import type { UploadedFile } from './tenants.service';

export class HousingPaymentService {
  static async generateQr(roomNumber: string) {
    const room = await prisma.room.findUnique({ where: { roomNumber }, include: { _count: { select: { tenants: true } } } });
    if (!room || room.status !== 'AVAILABLE' || room._count.tenants >= room.capacity) {
      throw new AppError('ห้องที่เลือกไม่พร้อมรับสมัคร กรุณาเลือกห้องใหม่', 409);
    }
    const amount = Number(room.monthlyRent);
    if (!Number.isFinite(amount) || amount <= 0) throw new AppError('ห้องที่เลือกยังไม่มีราคามัดจำที่ถูกต้อง', 422);
    const image = await PaymentProviderClient.generateQr(amount);
    if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new AppError('บริการชำระเงินส่งรูป QR ไม่ถูกต้อง กรุณาลองใหม่', 503);
    }
    return { roomNumber: room.roomNumber, amount, qrImage: `data:image/png;base64,${image.toString('base64')}` };
  }

  static async verifySlip(roomNumber: string, userId: number, file: UploadedFile, verificationId: number) {
    const room = await prisma.room.findUnique({ where: { roomNumber } });
    if (!room || room.status !== 'AVAILABLE') throw new AppError('ห้องที่เลือกไม่พร้อมรับสมัคร กรุณาเลือกห้องใหม่', 409);
    const amount = Number(room.monthlyRent);
    if (!Number.isFinite(amount) || amount <= 0) throw new AppError('ห้องที่เลือกยังไม่มีราคามัดจำที่ถูกต้อง', 422);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      throw new AppError('สลิปต้องเป็นรูป JPG, PNG หรือ WEBP', 400);
    }
    const slipHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const idempotencyKey = `housing:${userId}:${slipHash}`;
    const payment = await prisma.$transaction(async (tx) => {
      const previous = await tx.payment.findUnique({ where: { idempotencyKey } });
      if (previous) {
        if (previous.status === 'PAID' && previous.housingRoomId === room.id && Number(previous.amount) === amount
          && previous.slipPath && !previous.housingTenantId) {
          const rebound = await tx.payment.updateMany({ where: { id: previous.id, status: 'PAID', housingTenantId: null },
            data: { housingVerificationId: verificationId } });
          if (rebound.count !== 1) throw new AppError('รายการชำระนี้ถูกใช้ยื่นใบสมัครแล้ว', 409);
          return tx.payment.findUniqueOrThrow({ where: { id: previous.id } });
        }
        throw new AppError(previous.status === 'MANUAL_REVIEW'
          ? 'รายการนี้รอเจ้าหน้าที่ตรวจสอบ กรุณาอย่าโอนเงินซ้ำ'
          : 'สลิปนี้ถูกส่งตรวจหรือใช้งานแล้ว กรุณาตรวจสอบรายการเดิม', 409);
      }
      await assertSlipAvailable(tx, slipHash);
      return tx.payment.create({ data: {
        payerUserId: userId, housingRoomId: room.id, housingVerificationId: verificationId,
        amount, status: 'VERIFYING', idempotencyKey, slipHash,
      } });
    });
    if (payment.status === 'PAID') return payment;

    const uploadRoot = path.resolve(process.env.UPLOAD_ROOT || path.join(process.cwd(), 'uploads/private'));
    const ext = file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : '.jpg';
    const relativePath = `payment-slips/housing-${payment.id}-${crypto.randomUUID()}${ext}`;
    const slipPath = `uploads/private/${relativePath}`;
    try {
      await fs.mkdir(path.join(uploadRoot, 'payment-slips'), { recursive: true });
      await fs.writeFile(path.join(uploadRoot, relativePath), file.buffer, { mode: 0o600 });
      await prisma.payment.update({ where: { id: payment.id }, data: { slipPath } });
    } catch {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: 'SLIP_STORAGE_FAILED' } });
      throw new AppError('บันทึกไฟล์สลิปไม่สำเร็จ กรุณาติดต่อเจ้าหน้าที่', 503);
    }
    let result;
    try {
      result = await PaymentProviderClient.verifySlip({ ...file, originalname: file.originalname || `slip${ext}` });
    } catch {
      await prisma.payment.update({ where: { id: payment.id }, data: {
        status: 'MANUAL_REVIEW', failureReason: 'PAYMENT_PROVIDER_UNAVAILABLE',
      } });
      throw new AppError('บริการตรวจสลิปไม่พร้อมใช้งาน รายการรอเจ้าหน้าที่ตรวจสอบ กรุณาอย่าโอนเงินซ้ำ', 503);
    }
    const failure = result.duplicate ? 'สลิปนี้ถูกใช้แล้ว'
      : !result.success ? 'ไม่สามารถยืนยันธุรกรรมจากภาพนี้ได้ กรุณาใช้สลิปโอนเงินจริงที่อ่านได้ชัดเจน'
      : !result.recipientMatched ? 'บัญชีผู้รับเงินไม่ตรงกับบัญชีหอพัก'
      : result.amount !== amount ? `ยอดในสลิปไม่ตรงกับมัดจำห้องที่เลือก (${amount} บาท)`
      : !result.transactionId ? 'ผลตรวจไม่มีเลขอ้างอิงธุรกรรม จึงยังยืนยันการชำระเงินไม่ได้'
      : null;
    try {
      const verified = await prisma.$transaction(async (tx) => {
        await assertSlipAvailable(tx, slipHash, result.transactionId, { paymentId: payment.id });
        return tx.payment.update({ where: { id: payment.id, status: 'VERIFYING' }, data: {
          status: failure ? 'FAILED' : 'PAID', slipAmount: result.amount,
          providerTransactionId: result.transactionId,
          providerResponse: JSON.stringify(result.rawData), failureReason: failure,
          verifiedAt: failure ? null : new Date(),
        } });
      });
      if (failure) throw new AppError(failure, 422);
      return verified;
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 422) throw error;
      await prisma.payment.updateMany({ where: { id: payment.id, status: 'VERIFYING' }, data: {
        status: error instanceof AppError && error.statusCode === 409 ? 'FAILED' : 'MANUAL_REVIEW',
        failureReason: 'PAYMENT_FINALIZATION_FAILED',
      } });
      throw error;
    }
  }

  static async requireVerifiedPayment(db: Prisma.TransactionClient, input: {
    paymentId: number; userId: number; roomNumber: string; verificationId: number; slipPath: string;
    monthlyRent: string; depositAmount: string;
  }) {
    await db.$queryRaw`SELECT id FROM "Payment" WHERE id = ${input.paymentId} FOR UPDATE`;
    const payment = await db.payment.findUnique({ where: { id: input.paymentId } });
    if (payment?.housingRoomId) {
      await db.$queryRaw`SELECT id FROM "Room" WHERE id = ${payment.housingRoomId} FOR UPDATE`;
    }
    const room = payment?.housingRoomId ? await db.room.findUnique({ where: { id: payment.housingRoomId } }) : null;
    const parseMoney = (value: string) => Number(value.replace(/,/g, ''));
    if (!payment || payment.billId !== null || payment.payerUserId !== input.userId || payment.status !== 'PAID'
      || !payment.providerTransactionId || payment.housingVerificationId !== input.verificationId
      || payment.slipPath !== input.slipPath || !room || room.roomNumber !== input.roomNumber) {
      throw new AppError('ไม่พบผลตรวจสลิปที่ผ่านและตรงกับผู้สมัคร ห้อง และเอกสารนี้ กรุณาตรวจสอบหลักฐานใหม่', 422);
    }
    const amount = Number(payment.amount);
    if (amount !== Number(room.monthlyRent) || amount !== parseMoney(input.monthlyRent) || amount !== parseMoney(input.depositAmount)) {
      throw new AppError('ราคาห้องหรือยอดในสัญญาเปลี่ยนจากรายการชำระ กรุณาติดต่อเจ้าหน้าที่ก่อนดำเนินการต่อ', 409);
    }
    return payment;
  }
}
