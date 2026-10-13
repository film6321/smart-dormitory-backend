import { normalizeThaiNameForComparison } from './tenants.dto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../database/db';
import { AppError } from '../../middlewares/error-handler';
import { ROOM_RESERVATION_FILTER } from './tenants.repository';
import { getContractTerms, getSettingValue } from '../settings/settings.service';

const cents = (value: unknown) => Math.round(Number(value) * 100);
export class HousingDraftService {
  static async locked(tx: Prisma.TransactionClient, userId: number) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);
    let draft = await tx.housingApplicationDraft.findUnique({ where: { userId } });
    if (!draft) draft = await tx.housingApplicationDraft.create({ data: { userId } });
    if (draft.status === 'OPEN') {
      // Recover old, unconsumed housing transfers for this authenticated owner only.
      await tx.payment.updateMany({ where: { payerUserId: userId, billId: null, housingRoomId: { not: null }, housingTenantId: null, housingDraftId: null }, data: { housingDraftId: draft.id } });
      const last = await tx.payment.findFirst({ where: { housingDraftId: draft.id }, orderBy: { id: 'desc' } });
      if (!draft.roomId && last?.housingRoomId) draft = await tx.housingApplicationDraft.update({ where: { id: draft.id }, data: { roomId: last.housingRoomId } });
    }
    return draft;
  }
  static async summary(tx: Prisma.TransactionClient, draft: { id: number; userId: number; roomId: number | null; data: Prisma.JsonValue; status: string; version: number }) {
    const payments = await tx.payment.findMany({ where: { housingDraftId: draft.id, payerUserId: draft.userId }, orderBy: { id: 'asc' } });
    const paid = payments.filter(p => p.status === 'PAID');
    const credit = paid.reduce((sum, p) => sum + cents(p.amount), 0);
    const canRetrySlip = payments.some(p => p.status === 'FAILED' && p.failureReason === 'PROVIDER_PENDING');
    const pending = canRetrySlip || payments.some(p => ['VERIFYING', 'PENDING', 'MANUAL_REVIEW'].includes(p.status));
    const room = draft.roomId ? await tx.room.findUnique({ where: { id: draft.roomId }, include: { _count: { select: { tenants: { where: ROOM_RESERVATION_FILTER } } } } }) : null;
    const required = room ? cents(room.monthlyRent) : 0;
    const last = paid[paid.length - 1];
    const verification = await tx.idCardVerification.findFirst({ where: { userId: draft.userId, idDetected: true, ...(last?.housingVerificationId ? { id: last.housingVerificationId } : {}) }, orderBy: { id: 'desc' } });
    const account = await tx.user.findUnique({ where: { id: draft.userId }, select: { phone: true } });
    return { contractTerms: await getContractTerms(room, tx), id: draft.id, version: draft.version, status: draft.status, data: draft.data, registeredPhone: account?.phone?.trim() ?? '',
      roomNumber: room?.roomNumber ?? '', requiredAmount: required / 100, paidAmount: credit / 100,
      remainingAmount: Math.max(0, required - credit) / 100, excessAmount: Math.max(0, credit - required) / 100,
      pending, canRetrySlip, ready: !!room && credit === required && required > 0 && !pending,
      payment: last ? { id: last.id, slipPath: last.slipPath, status: last.status, amount: credit / 100 } : null,
      payments: payments.map(p => ({ id: p.id, amount: Number(p.amount), status: p.status, roomId: p.housingRoomId })),
      identity: verification ? { idCardImagePath: verification.imagePath, ocrData: { verificationId: verification.id, fullNameTh: verification.fullNameTh, birthDateTh: verification.birthDateTh, cardDetected: true } } : null };
  }
  static async bindIdentity(userId: number, verificationId: number) {
    return prisma.$transaction(async tx => {
      const draft = await this.locked(tx, userId);
      if (draft.status !== 'OPEN') throw new AppError('ส่งใบสมัครแล้ว ไม่สามารถเปลี่ยนเอกสารในฉบับร่าง', 409);
      const summary = await this.summary(tx, draft);
      if (summary.pending) throw new AppError('มีรายการชำระรอตรวจสอบ กรุณาจัดการรายการเดิมก่อนเปลี่ยนเอกสาร', 409);
      const current = await tx.idCardVerification.findUnique({ where: { id: verificationId } });
      if (!current || current.userId !== userId || !current.idDetected || !current.imagePath) throw new AppError('ไม่พบผลตรวจบัตรของบัญชีนี้', 422);
      const payments = await tx.payment.findMany({ where: { housingDraftId: draft.id, payerUserId: userId, status: 'PAID', housingTenantId: null }, include: { housingVerification: true } });
      for (const payment of payments) {
        const previous = payment.housingVerification;
        const same = previous?.citizenIdHash
          ? previous.citizenIdHash === current.citizenIdHash
          : !!previous?.fullNameTh && !!current.fullNameTh
            && !!normalizeThaiNameForComparison(previous.fullNameTh) && !previous.fullNameTh.includes('*') && !current.fullNameTh.includes('*')
            && normalizeThaiNameForComparison(previous.fullNameTh) === normalizeThaiNameForComparison(current.fullNameTh);
        if (!previous || previous.userId !== userId || !same) throw new AppError('บัตรไม่ตรงกับผู้สมัครที่ผูกยอดชำระเดิม กรุณาใช้บัตรเดิมหรือติดต่อผู้ดูแล ยอดเดิมยังคงอยู่', 409);
      }
      await tx.payment.updateMany({ where: { id: { in: payments.map(p => p.id) }, status: 'PAID', housingTenantId: null }, data: { housingVerificationId: verificationId } });
    });
  }
  static async get(userId: number) {
    return prisma.$transaction(async tx => this.summary(tx, await this.locked(tx, userId)));
  }
  static async save(userId: number, version: number, data: Record<string, unknown>, roomNumber?: string) {
    return prisma.$transaction(async tx => {
      const draft = await this.locked(tx, userId);
      if (draft.version !== version) throw new AppError('ใบสมัครถูกแก้จากอีกหน้าต่าง กรุณาโหลดฉบับร่างใหม่', 409);
      const tenant = await tx.tenant.findUnique({ where: { userId } });
      if (draft.status !== 'OPEN' || tenant && tenant.status !== 'REJECTED') throw new AppError('ส่งใบสมัครแล้ว กรุณาติดต่อผู้ดูแลเพื่อเปลี่ยนห้อง', 409);
      if (JSON.stringify(data).length > 32000) throw new AppError('ข้อมูลฉบับร่างยาวเกินกำหนด', 400);
      let roomId = draft.roomId;
      if (roomNumber !== undefined) {
        if (roomNumber === '') roomId = null;
        else {
          const room = await tx.room.findUnique({ where: { roomNumber }, include: { _count: { select: { tenants: { where: ROOM_RESERVATION_FILTER } } } } });
          const max = Number(await getSettingValue('maxOccupants')) || 4;
          if (!room || !['AVAILABLE', 'OCCUPIED'].includes(room.status) || room._count.tenants >= Math.min(room.capacity, max)) throw new AppError('ห้องที่เลือกไม่พร้อมรับสมัคร กรุณาเลือกห้องใหม่', 409);
          // Serialize room selection with price edits before binding the draft.
          await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${room.id} FOR UPDATE`;
          roomId = room.id;
        }
        const pending = await tx.payment.count({ where: { housingDraftId: draft.id, OR: [{ status: { in: ['PENDING', 'VERIFYING', 'MANUAL_REVIEW'] } }, { status: 'FAILED', failureReason: 'PROVIDER_PENDING' }] } });
        if (pending && roomId !== draft.roomId) throw new AppError('มีรายการชำระรอตรวจสอบ กรุณาจัดการรายการเดิมก่อนเปลี่ยนห้อง อย่าโอนซ้ำ', 409);
      }
      const allowed: Record<string, Prisma.InputJsonValue> = {};
      for (const key of ['personalInformation', 'emergencyContact', 'roomPreference', 'contractData', 'activeStep']) if (data[key] !== undefined) allowed[key] = data[key] as Prisma.InputJsonValue;
      const updated = await tx.housingApplicationDraft.update({ where: { id: draft.id }, data: { roomId, data: allowed, version: { increment: 1 } } });
      return this.summary(tx, updated);
    }, { timeout: 15000 });
  }
}
