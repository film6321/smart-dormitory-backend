import { HousingDraftService } from './housing-draft.service';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../database/db';
import { AppError } from '../../middlewares/error-handler';
import { PaymentProviderClient } from '../billing/payment.provider';
import { assertSlipAvailable } from '../billing/payment-slip-guard';
import { ROOM_RESERVATION_FILTER } from './tenants.repository';
import { getContractTerms, getSettingValue } from '../settings/settings.service';
import type { UploadedFile } from './tenants.service';

const isProviderPendingResponse = (value: string | null) => {
  if (!value) return false;
  try {
    const payload: unknown = JSON.parse(value);
    if (!payload || typeof payload !== 'object') return false;
    const record = payload as Record<string, unknown>;
    const providerError = record.error;
    const errorRecord = providerError && typeof providerError === 'object'
      ? providerError as Record<string, unknown>
      : null;
    const code = typeof record.code === 'string' ? record.code : errorRecord?.code;
    const message = [record.message, typeof providerError === 'string' ? providerError : errorRecord?.message]
      .filter((part): part is string => typeof part === 'string').join(' ');
    return code === 'SLIP_PENDING' || /bangkok bank slip is pending|slip is pending/i.test(message);
  } catch {
    return false;
  }
};

export class HousingPaymentService {
  private static async getAvailableRoom(roomNumber: string) {
    const room = await prisma.room.findUnique({ where: { roomNumber }, include: { _count: { select: { tenants: { where: ROOM_RESERVATION_FILTER } } } } });
    const maxOccupants = Number(await getSettingValue('maxOccupants')) || 4;
    if (!room || !['AVAILABLE', 'OCCUPIED'].includes(room.status) || room._count.tenants >= Math.min(room.capacity, maxOccupants)) {
      throw new AppError('ห้องที่เลือกไม่พร้อมรับสมัคร กรุณาเลือกห้องใหม่', 409);
    }
    return room;
  }

  static async generateQr(roomNumber: string) {
    const room = await this.getAvailableRoom(roomNumber);
    const terms = await getContractTerms(room);
    if (Object.values(terms).some(value => !value.trim())) throw new AppError('ผู้ดูแลยังตั้งค่าเงื่อนไขสัญญาไม่ครบ กรุณาติดต่อผู้ดูแลก่อนชำระเงิน', 409);
    const amount = Number(room.monthlyRent);
    if (!Number.isFinite(amount) || amount <= 0) throw new AppError('ห้องที่เลือกยังไม่มีราคามัดจำที่ถูกต้อง', 422);
    const image = await PaymentProviderClient.generateQr(amount);
    if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new AppError('บริการชำระเงินส่งรูป QR ไม่ถูกต้อง กรุณาลองใหม่', 503);
    }
    return { roomNumber: room.roomNumber, amount, qrImage: `data:image/png;base64,${image.toString('base64')}` };
  }

  static async generateDraftQr(userId: number, roomNumber: string) {
    const summary = await HousingDraftService.get(userId);
    if (Object.values(summary.contractTerms).some(value => !value.trim())) throw new AppError('ผู้ดูแลยังตั้งค่าเงื่อนไขสัญญาไม่ครบ กรุณาติดต่อผู้ดูแลก่อนชำระเงิน', 409);
    if (summary.status !== 'OPEN' || summary.roomNumber !== roomNumber) throw new AppError('กรุณาบันทึกห้องในฉบับร่างก่อนสร้าง QR', 409);
    await this.getAvailableRoom(roomNumber);
    if (summary.pending) throw new AppError('มีรายการรอตรวจสอบ กรุณาอย่าโอนซ้ำ', 409);
    if (summary.remainingAmount <= 0) throw new AppError('ยอดชำระครบแล้ว ไม่ต้องโอนเพิ่ม', 409);
    const image = await PaymentProviderClient.generateQr(summary.remainingAmount);
    if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new AppError('บริการชำระเงินส่งรูป QR ไม่ถูกต้อง', 503);
    return { roomNumber, amount: summary.remainingAmount, qrImage: `data:image/png;base64,${image.toString('base64')}` };
  }
  static async verifyDraftSlip(roomNumber: string, userId: number, file: UploadedFile, verificationId: number) {
    const summary = await HousingDraftService.get(userId);
    return this.verifySlip(roomNumber, userId, file, verificationId, summary.id);
  }

  static async verifySlip(roomNumber: string, userId: number, file: UploadedFile, verificationId: number, draftId?: number) {
    const room = await this.getAvailableRoom(roomNumber);
    let amount = Number(room.monthlyRent);
    if (!Number.isFinite(amount) || amount <= 0) throw new AppError('ห้องที่เลือกยังไม่มีราคามัดจำที่ถูกต้อง', 422);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      throw new AppError('สลิปต้องเป็นรูป JPG, PNG หรือ WEBP', 400);
    }
    const slipHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const idempotencyKey = `housing:${userId}:${slipHash}`;
    const payment = await prisma.$transaction(async (tx) => {
      if (draftId !== undefined) {
        const draft = await HousingDraftService.locked(tx, userId);
        if (draft.id !== draftId || draft.status !== 'OPEN' || draft.roomId !== room.id) throw new AppError('ห้องในฉบับร่างเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด', 409);
        await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${room.id} FOR UPDATE`;
        amount = (await HousingDraftService.summary(tx, draft)).remainingAmount;
      } else {
        await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${room.id} FOR UPDATE`;
        const currentRoom = await tx.room.findUnique({ where: { id: room.id } });
        if (!currentRoom || Number(currentRoom.monthlyRent) !== amount) throw new AppError('ราคาห้องเปลี่ยนแล้ว กรุณาโหลดข้อมูลก่อนตรวจสลิป', 409);
      }
      const previous = await tx.payment.findUnique({ where: { idempotencyKey } });
      if (previous) {
        if (previous.status === 'PAID' && (draftId !== undefined ? previous.housingDraftId === draftId : previous.housingRoomId === room.id && Number(previous.amount) === amount)
          && previous.slipPath && !previous.housingTenantId) {
          const rebound = await tx.payment.updateMany({ where: { id: previous.id, status: 'PAID', housingTenantId: null },
            data: { housingVerificationId: verificationId } });
          if (rebound.count !== 1) throw new AppError('รายการชำระนี้ถูกใช้ยื่นใบสมัครแล้ว', 409);
          return tx.payment.findUniqueOrThrow({ where: { id: previous.id } });
        }
        const pendingSlip = previous.failureReason === 'PROVIDER_PENDING'
          || isProviderPendingResponse(previous.providerResponse);
        if (pendingSlip && previous.status === 'FAILED' && previous.housingRoomId === room.id
          && Number(previous.amount) === amount && previous.updatedAt <= new Date(Date.now() - 5 * 60 * 1000)) {
          const claimed = await tx.payment.updateMany({
            where: { id: previous.id, status: 'FAILED', updatedAt: { lte: new Date(Date.now() - 5 * 60 * 1000) } },
            data: { status: 'VERIFYING', housingVerificationId: verificationId, failureReason: null },
          });
          if (claimed.count === 1) {
            return tx.payment.findUniqueOrThrow({ where: { id: previous.id } });
          }
        }
        if (pendingSlip) {
          throw new AppError('ธนาคารกำลังรอยืนยันรายการ กรุณารออย่างน้อย 5 นาทีแล้วส่งสลิปเดิมตรวจอีกครั้ง อย่าโอนซ้ำ', 409);
        }
        throw new AppError(previous.status === 'MANUAL_REVIEW'
          ? 'รายการนี้รอเจ้าหน้าที่ตรวจสอบ กรุณาอย่าโอนเงินซ้ำ'
          : 'สลิปนี้ถูกส่งตรวจหรือใช้งานแล้ว กรุณาตรวจสอบรายการเดิม', 409);
      }
      if (draftId !== undefined) {
        const summary = await HousingDraftService.summary(tx, (await tx.housingApplicationDraft.findUniqueOrThrow({ where: { id: draftId } })));
        if (summary.pending) throw new AppError('มีรายการรอตรวจสอบ กรุณาอย่าโอนซ้ำ', 409);
        amount = summary.remainingAmount;
        if (amount <= 0) throw new AppError('ชำระครบแล้ว ไม่ต้องโอนเพิ่ม', 409);
      }
      await assertSlipAvailable(tx, slipHash);
      return tx.payment.create({ data: {
        payerUserId: userId, housingRoomId: room.id, housingVerificationId: verificationId, ...(draftId !== undefined ? { housingDraftId: draftId } : {}),
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
      : result.retryable ? 'PROVIDER_PENDING'
      : !result.recipientMatched && result.transactionId ? (result.message || 'บัญชีผู้รับไม่ตรงกับบัญชีหอพัก')
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
      if (failure) {
        if (result.retryable) {
          throw new AppError('ธนาคารกำลังรอยืนยันรายการ กรุณารออย่างน้อย 5 นาทีแล้วส่งสลิปเดิมตรวจอีกครั้ง อย่าโอนซ้ำ', 409);
        }
        throw new AppError(failure, 422);
      }
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
    if (payment?.housingDraftId) {
      const draft = await db.housingApplicationDraft.findUnique({ where: { id: payment.housingDraftId } });
      if (!draft || draft.userId !== input.userId) throw new AppError('ไม่พบฉบับร่างของผู้สมัคร', 409);
      const selected = draft.roomId ? await db.room.findUnique({ where: { id: draft.roomId } }) : null;
      const transfers = await db.payment.findMany({ where: { housingDraftId: draft.id, payerUserId: input.userId, status: 'PAID' } });
      const total = transfers.reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0);
      const due = selected ? Math.round(Number(selected.monthlyRent) * 100) : 0;
      const pending = await db.payment.count({ where: { housingDraftId: draft.id, OR: [{ status: { in: ['PENDING', 'VERIFYING', 'MANUAL_REVIEW'] } }, { status: 'FAILED', failureReason: 'PROVIDER_PENDING' }] } });
      const parse = (v: string) => Math.round(Number(v.replace(/,/g, '')) * 100);
      if (!selected || selected.roomNumber !== input.roomNumber || !due || total !== due || pending
        || parse(input.monthlyRent) !== due || parse(input.depositAmount) !== due || payment.slipPath !== input.slipPath
        || payment.billId !== null || payment.housingVerificationId !== input.verificationId
        || payment.status !== 'PAID' || payment.payerUserId !== input.userId || !payment.providerTransactionId
        || !transfers.length || transfers.some(p => !p.providerTransactionId || p.housingTenantId !== payment.housingTenantId)) {
        throw new AppError('ยอดชำระรวมยังไม่ตรงกับห้อง หรือมีรายการรอตรวจสอบ/ยอดส่วนเกิน กรุณาตรวจรายการเดิม อย่าโอนซ้ำ', 409);
      }
      return { ...payment, housingRoomId: selected.id };
    }
    // submitApplication already locks the old and selected rooms in ID order.
    // Do not acquire another room lock here after the payment lock.
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
