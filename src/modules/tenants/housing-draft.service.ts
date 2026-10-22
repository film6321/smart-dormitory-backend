import { normalizeThaiNameForComparison } from './tenants.dto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../database/db';
import { AppError } from '../../middlewares/error-handler';
import { ROOM_RESERVATION_FILTER } from './tenants.repository';
import { getContractTerms, getSettingValue } from '../settings/settings.service';

const cents = (value: unknown) => Math.round(Number(value) * 100);
export class HousingDraftService {
  // Call only after taking the Room lock. PostgreSQL time owns hold expiry.
  static async heldPlaces(tx: Prisma.TransactionClient, roomId: number, exceptUserId = 0) {
    const rows = await tx.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM "HousingApplicationDraft" d
      WHERE d."roomId" = ${roomId} AND d.status = 'OPEN' AND d."userId" <> ${exceptUserId}
        AND d."roomHoldExpiresAt" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "Tenant" t WHERE t."userId" = d."userId" AND t."roomId" = d."roomId"
          AND t."isActive" = true AND t.status IN ('PENDING', 'APPROVED', 'ACTIVE'))
        AND d."roomHoldExpiresAt" > clock_timestamp()`;
    return Number(rows[0]?.count ?? 0);
  }

  static async assertHeldCapacity(tx: Prisma.TransactionClient, room: { id: number; capacity: number }, occupants: number, maxOccupants: number, exceptUserId = 0) {
    if (occupants + await this.heldPlaces(tx, room.id, exceptUserId) >= Math.min(room.capacity, maxOccupants)) {
      throw new AppError('ห้องนี้เต็มหรือถูกกันที่พักไว้แล้ว กรุณาเลือกห้องอื่นก่อนชำระเงิน', 409);
    }
  }

  static async reserveLocked(tx: Prisma.TransactionClient, draft: { id: number; userId: number; roomId: number | null; status: string; roomHoldExpiresAt: Date | null }) {
    if (draft.status !== 'OPEN' || !draft.roomId) throw new AppError('กรุณาบันทึกห้องในฉบับร่างก่อนชำระเงิน', 409);
    await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${draft.roomId} FOR UPDATE`;
    const room = await tx.room.findUnique({ where: { id: draft.roomId }, include: { _count: { select: { tenants: { where: ROOM_RESERVATION_FILTER } } } } });
    if (!room || !['AVAILABLE', 'OCCUPIED'].includes(room.status)) throw new AppError('ห้องนี้ไม่พร้อมรับสมัคร กรุณาเลือกห้องอื่น', 409);
    await this.assertHeldCapacity(tx, room, room._count.tenants, Number(await getSettingValue('maxOccupants')) || 4, draft.userId);
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const expiresAt = draft.roomHoldExpiresAt && draft.roomHoldExpiresAt > clock.now
      ? draft.roomHoldExpiresAt : new Date(clock.now.getTime() + 10 * 60 * 1000);
    // Hold metadata is separate from the versioned application fields; refreshing QR does not extend an active hold.
    await tx.housingApplicationDraft.update({ where: { id: draft.id }, data: { roomHoldExpiresAt: expiresAt } });
    return { room, expiresAt, serverTime: clock.now };
  }

  static async reserveForQr(userId: number, roomNumber: string) {
    return prisma.$transaction(async tx => {
      const draft = await this.locked(tx, userId);
      await this.assertNoPendingRefundRequest(tx, draft.id);
      const summary = await this.summary(tx, draft);
      if (summary.roomNumber !== roomNumber) throw new AppError('กรุณาบันทึกห้องในฉบับร่างก่อนสร้าง QR', 409);
      if (summary.pending) throw new AppError('มีรายการรอตรวจสอบ กรุณาอย่าโอนซ้ำ', 409);
      if (Object.values(summary.contractTerms).some(value => !value.trim())) throw new AppError('ผู้ดูแลยังตั้งค่าเงื่อนไขสัญญาไม่ครบ กรุณาติดต่อผู้ดูแลก่อนชำระเงิน', 409);
      if (summary.remainingAmount <= 0) throw new AppError('ยอดชำระครบแล้ว ไม่ต้องโอนเพิ่ม', 409);
      const reservation = await this.reserveLocked(tx, draft);
      return { ...summary, reservation };
    }, { timeout: 15000 });
  }
  static async assertNoPendingRefundRequest(tx: Prisma.TransactionClient, draftId: number) {
    const request = await tx.housingRefundRequest.findFirst({ where: { draftId, status: 'PENDING' }, select: { id: true } });
    if (request) throw new AppError('มีคำขอคืนเงินรอผู้ดูแลดำเนินการ จึงพักการแก้ไขและชำระใบสมัครไว้ก่อน', 409);
  }
  static async assertEditable(userId: number) {
    return prisma.$transaction(async tx => {
      const draft = await this.locked(tx, userId);
      if (draft.status !== 'OPEN') throw new AppError('ส่งใบสมัครแล้ว ไม่สามารถแก้ไขเอกสารในฉบับร่าง', 409);
      await this.assertNoPendingRefundRequest(tx, draft.id);
    });
  }

  static async locked(tx: Prisma.TransactionClient, userId: number) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);
    let draft = await tx.housingApplicationDraft.findUnique({ where: { userId } });
    if (!draft) draft = await tx.housingApplicationDraft.create({ data: { userId } });
    if (draft.status === 'SUBMITTED') {
      // User is locked above, as it is for rejection, approval and submission.
      const tenant = await tx.tenant.findUnique({ where: { userId } });
      if (tenant?.status === 'REJECTED') {
        const payments = await tx.payment.findMany({ where: { housingDraftId: draft.id } });
        if (payments.some(payment => payment.payerUserId !== userId || payment.billId !== null
          || payment.housingApprovedAt !== null
          || (payment.housingTenantId !== null && (payment.housingTenantId !== tenant.id || payment.status !== 'PAID')))) {
          throw new AppError('ยอดชำระเดิมต้องให้ผู้ดูแลตรวจสอบก่อนแก้ใบสมัคร กรุณาอย่าโอนซ้ำ', 409);
        }
        // Return only this rejected application's unapproved credit to its owner.
        // Payment amount, status, provider transaction and evidence remain unchanged.
        await tx.payment.updateMany({
          where: { housingDraftId: draft.id, payerUserId: userId, housingTenantId: tenant.id,
            billId: null, housingApprovedAt: null, status: 'PAID' },
          data: { housingTenantId: null },
        });
        const saved = draft.data && typeof draft.data === 'object' && !Array.isArray(draft.data) ? draft.data : {};
        draft = await tx.housingApplicationDraft.update({ where: { id: draft.id },
          data: { status: 'OPEN', version: { increment: 1 }, data: { ...saved, activeStep: 0 } } });
      } else if (!tenant) {
        // Admin purge removes the prior stay record and its consumed payments.
        // Reopen only when any remaining draft credit is still owned by this user
        // and is not linked to a bill, approved deposit, or prior tenant.
        const payments = await tx.payment.findMany({ where: { housingDraftId: draft.id } });
        if (payments.some(payment => payment.payerUserId !== userId || payment.billId !== null
          || payment.housingApprovedAt !== null || payment.housingTenantId !== null)) {
          throw new AppError('ข้อมูลชำระเงินเดิมต้องให้ผู้ดูแลตรวจสอบก่อนสมัครใหม่', 409);
        }
        const saved = draft.data && typeof draft.data === 'object' && !Array.isArray(draft.data) ? draft.data : {};
        draft = await tx.housingApplicationDraft.update({ where: { id: draft.id },
          data: { status: 'OPEN', roomHoldExpiresAt: null, version: { increment: 1 }, data: { ...saved, activeStep: 0 } } });
      }
    }
    if (draft.status === 'OPEN') {
      // Recover old, unconsumed housing transfers for this authenticated owner only.
      await tx.payment.updateMany({ where: { payerUserId: userId, billId: null, housingRoomId: { not: null }, housingTenantId: null, housingDraftId: null }, data: { housingDraftId: draft.id } });
      const last = await tx.payment.findFirst({ where: { housingDraftId: draft.id }, orderBy: { id: 'desc' } });
      if (!draft.roomId && last?.housingRoomId) draft = await tx.housingApplicationDraft.update({ where: { id: draft.id }, data: { roomId: last.housingRoomId } });
      if (draft.roomHoldExpiresAt) {
        const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
        if (draft.roomHoldExpiresAt <= clock.now) {
          // Release the room at expiry, while keeping payment records as credit for this applicant.
          draft = await tx.housingApplicationDraft.update({ where: { id: draft.id }, data: { roomHoldExpiresAt: null } });
        }
      }
    }
    return draft;
  }
  static async summary(tx: Prisma.TransactionClient, draft: { id: number; userId: number; roomId: number | null; data: Prisma.JsonValue; status: string; version: number; roomHoldExpiresAt?: Date | null }) {
    const payments = await tx.payment.findMany({ where: { housingDraftId: draft.id, payerUserId: draft.userId }, orderBy: { id: 'asc' } });
    const paid = payments.filter(p => p.status === 'PAID');
    const gross = paid.reduce((sum, p) => sum + cents(p.amount), 0);
    const refunds = await tx.housingRefund.aggregate({ where: { draftId: draft.id }, _sum: { amount: true } });
    const refunded = cents(refunds._sum.amount ?? 0);
    const credit = Math.max(0, gross - refunded);
    const canRetrySlip = payments.some(p => p.status === 'FAILED' && p.failureReason === 'PROVIDER_PENDING');
    const pending = canRetrySlip || payments.some(p => ['VERIFYING', 'PENDING', 'MANUAL_REVIEW'].includes(p.status));
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const roomHoldActive = !!draft.roomHoldExpiresAt && draft.roomHoldExpiresAt > clock.now;
    const room = draft.roomId ? await tx.room.findUnique({ where: { id: draft.roomId }, include: { _count: { select: { tenants: { where: ROOM_RESERVATION_FILTER } } } } }) : null;
    const contractTerms = await getContractTerms(room, tx);
    const rent = room ? cents(room.monthlyRent) : 0;
    const deposit = room ? cents(contractTerms.depositAmount) : 0;
    const keycardDeposit = room ? cents(contractTerms.keycardDeposit) : 0;
    const required = rent + deposit + keycardDeposit;
    const last = paid[paid.length - 1];
    const verification = await tx.idCardVerification.findFirst({ where: { userId: draft.userId, idDetected: true, ...(last?.housingVerificationId ? { id: last.housingVerificationId } : {}) }, orderBy: { id: 'desc' } });
    const account = await tx.user.findUnique({ where: { id: draft.userId }, select: { phone: true, tenant: { select: { status: true } } } });
    const refundRequest = await tx.housingRefundRequest.findFirst({ where: { draftId: draft.id }, orderBy: { requestedAt: 'desc' } });
    return { applicationBlockedReason: account?.tenant?.status === 'INACTIVE' ? 'บันทึกย้ายออกแล้ว กรุณารอผู้ดูแลล้างข้อมูลการพักเดิมก่อนสมัครใหม่' : null,
      roomHoldExpiresAt: draft.roomHoldExpiresAt ?? null, roomHoldActive, holdProtectedByPayment: roomHoldActive && (pending || credit > 0),
      contractTerms, id: draft.id, version: draft.version, status: draft.status, data: draft.data, registeredPhone: account?.phone?.trim() ?? '',
      roomNumber: room?.roomNumber ?? '', monthlyRentAmount: rent / 100, depositAmount: deposit / 100, keycardDepositAmount: keycardDeposit / 100,
      requiredAmount: required / 100, grossPaidAmount: gross / 100, refundedAmount: refunded / 100, paidAmount: credit / 100,
      remainingAmount: Math.max(0, required - credit) / 100, excessAmount: Math.max(0, credit - required) / 100,
      pending, canRetrySlip, ready: !!room && credit >= required && required > 0 && !pending && refundRequest?.status !== 'PENDING',
      refundRequest: refundRequest ? { id: refundRequest.id, amount: Number(refundRequest.amount), reason: refundRequest.reason,
        accountName: refundRequest.accountName, accountNumber: refundRequest.accountNumber,
        status: refundRequest.status, adminNote: refundRequest.adminNote, requestedAt: refundRequest.requestedAt, resolvedAt: refundRequest.resolvedAt } : null,
      payment: last ? { id: last.id, slipPath: last.slipPath, status: last.status, amount: credit / 100 } : null,
      payments: payments.map(p => ({ id: p.id, amount: Number(p.amount), status: p.status, roomId: p.housingRoomId })),
      identity: verification ? { idCardImagePath: verification.imagePath, ocrData: { verificationId: verification.id, fullNameTh: verification.fullNameTh, birthDateTh: verification.birthDateTh, cardDetected: true } } : null };
  }
  static async bindIdentity(userId: number, verificationId: number) {
    return prisma.$transaction(async tx => {
      const draft = await this.locked(tx, userId);
      await this.assertNoPendingRefundRequest(tx, draft.id);
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
      await this.assertNoPendingRefundRequest(tx, draft.id);
      const tenant = await tx.tenant.findUnique({ where: { userId } });
      if (draft.status !== 'OPEN' || tenant && tenant.status !== 'REJECTED') throw new AppError('ส่งใบสมัครแล้ว กรุณาติดต่อผู้ดูแลเพื่อเปลี่ยนห้อง', 409);
      if (JSON.stringify(data).length > 32000) throw new AppError('ข้อมูลฉบับร่างยาวเกินกำหนด', 400);
      let roomId = draft.roomId;
      if (roomNumber !== undefined) {
        if (roomNumber === '') roomId = null;
        else {
          const room = await tx.room.findUnique({ where: { roomNumber }, include: { _count: { select: { tenants: { where: ROOM_RESERVATION_FILTER } } } } });
          const max = Number(await getSettingValue('maxOccupants')) || 4;
          if (!room || room.id !== draft.roomId && (!['AVAILABLE', 'OCCUPIED'].includes(room.status) || room._count.tenants >= Math.min(room.capacity, max))) throw new AppError('ห้องที่เลือกไม่พร้อมรับสมัคร กรุณาเลือกห้องใหม่', 409);
          // Lock old/new rooms in order before releasing or moving a hold.
          for (const id of [...new Set([draft.roomId, room.id].filter((value): value is number => value !== null))].sort((a, b) => a - b)) {
            await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${id} FOR UPDATE`;
          }
          roomId = room.id;
        }
        const pending = await tx.payment.count({ where: { housingDraftId: draft.id, OR: [{ status: { in: ['PENDING', 'VERIFYING', 'MANUAL_REVIEW'] } }, { status: 'FAILED', failureReason: 'PROVIDER_PENDING' }] } });
        if (pending && roomId !== draft.roomId) throw new AppError('มีรายการชำระรอตรวจสอบ กรุณาจัดการรายการเดิมก่อนเปลี่ยนห้อง อย่าโอนซ้ำ', 409);
      }
      const allowed: Record<string, Prisma.InputJsonValue> = {};
      for (const key of ['personalInformation', 'emergencyContact', 'roomPreference', 'contractData', 'activeStep']) if (data[key] !== undefined) allowed[key] = data[key] as Prisma.InputJsonValue;
      const updated = await tx.housingApplicationDraft.update({ where: { id: draft.id }, data: { roomId, data: allowed, version: { increment: 1 },
        ...(roomId !== draft.roomId ? { roomHoldExpiresAt: null } : {}) } });
      return this.summary(tx, updated);
    }, { timeout: 15000 });
  }
}
