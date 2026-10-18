import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from '../../database/db';
import { AppError } from '../../middlewares/error-handler';
import { HousingDraftService } from './housing-draft.service';
import type { UploadedFile } from './tenants.service';
import { publishAdminAlert, publishNotificationAlert, publishResidentStatus } from '../../realtime/notification-gateway';
import { getSettingValue } from '../settings/settings.service';

export class HousingRefundService {
  static async list(userId?: number) {
    const drafts = await prisma.housingApplicationDraft.findMany({
      where: { ...(userId !== undefined ? { userId } : {}), OR: [{ refundRequests: { some: {} } }, { refunds: { some: {} } }] },
      include: { user: { select: { username: true, email: true } }, payments: { where: { status: 'PAID' } }, refunds: { orderBy: { createdAt: 'desc' } },
        refundRequests: { orderBy: { requestedAt: 'desc' }, include: { resolvedBy: { select: { username: true } } } } },
      orderBy: { updatedAt: 'desc' }, take: 200,
    });
    const rooms = await prisma.room.findMany({ where: { id: { in: drafts.flatMap(d => d.roomId === null ? [] : [d.roomId]) } } });
    const configuredDeposit = await getSettingValue('contractDepositAmount');
    const configuredKeycardDeposit = await getSettingValue('contractKeycardDeposit');
    const mapped = drafts.map(draft => {
      const room = rooms.find(value => value.id === draft.roomId);
      const gross = draft.payments.reduce((sum, payment) => sum + Math.round(Number(payment.amount) * 100), 0);
      const refunded = draft.refunds.reduce((sum, refund) => sum + Math.round(Number(refund.amount) * 100), 0);
      const monthlyRent = Math.round(Number(room?.monthlyRent ?? 0) * 100);
      const deposit = room ? Math.round(Number(configuredDeposit.trim() || room.monthlyRent) * 100) : 0;
      const keycardDeposit = room ? Math.round(Number(configuredKeycardDeposit.trim() || 0) * 100) : 0;
      const due = monthlyRent + deposit + keycardDeposit;
      return { id: draft.id, userId: draft.userId, version: draft.version, status: draft.status, applicant: draft.user.username || draft.user.email,
        roomNumber: room?.roomNumber ?? '', monthlyRentAmount: monthlyRent / 100, depositAmount: deposit / 100,
        keycardDepositAmount: keycardDeposit / 100,
        requiredAmount: due / 100, paidAmount: (gross - refunded) / 100, refundedAmount: refunded / 100,
        excessAmount: room ? Math.max(0, gross - refunded - due) / 100 : 0,
        refunds: draft.refunds.map(refund => ({ id: refund.id, amount: Number(refund.amount), reference: refund.reference, createdAt: refund.createdAt })),
        refundRequests: draft.refundRequests.map(request => ({ id: request.id, amount: Number(request.amount), reason: request.reason,
          accountName: request.accountName, accountNumber: request.accountNumber,
          status: request.status, adminNote: request.adminNote, requestedAt: request.requestedAt, resolvedAt: request.resolvedAt,
          resolvedBy: request.resolvedBy?.username ?? null })) };
    });
    return mapped;
  }

  static async request(userId: number, accountName: string, accountNumber: string, reason?: string) {
    const normalizedReason = reason?.trim() || null;
    if (normalizedReason && normalizedReason.length > 500) throw new AppError('เหตุผลคำขอยาวเกินกำหนด', 400);
    const result = await prisma.$transaction(async tx => {
      const draft = await HousingDraftService.locked(tx, userId);
      if (draft.status !== 'OPEN') throw new AppError('ส่งใบสมัครแล้ว ไม่สามารถขอคืนยอดจากฉบับร่างนี้ได้', 409);
      const existing = await tx.housingRefundRequest.findFirst({ where: { draftId: draft.id, status: 'PENDING' } });
      if (existing) return { request: existing, userId, repeated: true };
      const consumed = await tx.payment.count({ where: { housingDraftId: draft.id, OR: [{ housingTenantId: { not: null } }, { housingApprovedAt: { not: null } }] } });
      const summary = await HousingDraftService.summary(tx, draft);
      if (summary.pending || consumed || summary.paidAmount <= 0) throw new AppError('ไม่มียอดเครดิตที่พร้อมขอคืน หรือยังมีรายการชำระรอตรวจสอบ', 409);
      const request = await tx.housingRefundRequest.create({ data: { draftId: draft.id, amount: summary.paidAmount, reason: normalizedReason,
        accountName, accountNumber } });
      await tx.housingApplicationDraft.update({ where: { id: draft.id }, data: { roomHoldExpiresAt: null, version: { increment: 1 } } });
      return { request, userId, repeated: false };
    }, { timeout: 15000 });
    if (!result.repeated) publishAdminAlert(result.request.id, 'HOUSING_REFUND_REQUEST', 'มีคำขอคืนเงินจากใบสมัคร', 'PENDING');
    return { id: result.request.id, amount: Number(result.request.amount), reason: result.request.reason,
      accountName: result.request.accountName, accountNumber: result.request.accountNumber,
      status: result.request.status, requestedAt: result.request.requestedAt };
  }

  static async record(draftId: number, adminId: number, input: { version: number; amount: number; reference: string; idempotencyKey: string }, proof: UploadedFile) {
    if (!Number.isInteger(input.version) || input.version < 1 || !input.reference.trim() || input.reference.length > 100
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.idempotencyKey)) throw new AppError('Invalid refund reference or version', 400);
    const cents = Math.round(input.amount * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0 || Math.abs(input.amount * 100 - cents) > 0.000001) throw new AppError('ยอดคืนต้องมากกว่า 0 และไม่เกิน 2 ตำแหน่งทศนิยม', 400);
    const signature = proof.buffer.subarray(0, 12);
    const extension = proof.mimetype === 'image/png' && signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? '.png'
      : proof.mimetype === 'image/jpeg' && signature.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? '.jpg'
      : proof.mimetype === 'image/webp' && signature.toString('ascii', 0, 4) === 'RIFF' && signature.toString('ascii', 8, 12) === 'WEBP' ? '.webp' : null;
    if (!extension || proof.buffer.length > 10 * 1024 * 1024) throw new AppError('หลักฐานคืนเงินต้องเป็นภาพ JPG, PNG หรือ WebP ไม่เกิน 10 MB', 400);
    const hash = crypto.createHash('sha256').update(proof.buffer).digest('hex');
    const directory = path.resolve(process.env.UPLOAD_ROOT || 'uploads/private', 'housing-refunds');
    const filename = crypto.randomUUID() + extension;
    const absolute = path.join(directory, filename);
    const proofPath = `uploads/private/housing-refunds/${filename}`;
    await fs.mkdir(directory, { recursive: true }); await fs.writeFile(absolute, proof.buffer, { mode: 0o600 });
    let kept = false;
    try {
      const result = await prisma.$transaction(async tx => {
        const source = await tx.housingApplicationDraft.findUnique({ where: { id: draftId } });
        if (!source) throw new AppError('ไม่พบฉบับร่าง', 404);
        const draft = await HousingDraftService.locked(tx, source.userId);
        const actor = await tx.user.findUnique({ where: { id: adminId }, select: { role: true } });
        if (actor?.role !== 'ADMIN') throw new AppError('ไม่มีสิทธิ์บันทึกคืนเงิน', 403);
        const previous = await tx.housingRefund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (previous) {
          if (previous.draftId !== draftId || Number(previous.amount) !== input.amount || previous.reference !== input.reference || previous.proofHash !== hash) throw new AppError('รหัสรายการซ้ำกับข้อมูลอื่น', 409);
          return { refund: previous, userId: source.userId };
        }
        if (draft.status !== 'OPEN' || draft.version !== input.version) throw new AppError('ฉบับร่างเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึกคืนเงิน', 409);
        if (draft.roomId) await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${draft.roomId} FOR UPDATE`;
        const summary = await HousingDraftService.summary(tx, draft);
        const consumed = await tx.payment.count({ where: { housingDraftId: draftId, OR: [{ housingTenantId: { not: null } }, { housingApprovedAt: { not: null } }] } });
        const refundRequest = await tx.housingRefundRequest.findFirst({ where: { draftId, status: 'PENDING' }, orderBy: { requestedAt: 'desc' } });
        if (summary.pending || consumed || !refundRequest || cents !== Math.round(Number(refundRequest.amount) * 100)
          || cents !== Math.round(summary.paidAmount * 100)) throw new AppError('ยอดเครดิตหรือคำขอคืนเงินเปลี่ยนแล้ว กรุณาตรวจข้อมูลล่าสุดก่อนดำเนินการ', 409);
        const refund = await tx.housingRefund.create({ data: { draftId, amount: input.amount, reference: input.reference,
          idempotencyKey: input.idempotencyKey, proofHash: hash, proofPath, recordedById: adminId } });
        await tx.housingRefundRequest.update({ where: { id: refundRequest.id }, data: { status: 'COMPLETED', resolvedById: adminId, resolvedAt: new Date() } });
        await tx.housingApplicationDraft.update({ where: { id: draftId }, data: { version: { increment: 1 } } });
        const notification = await tx.notification.create({ data: {
          userId: source.userId,
          channel: 'IN_APP',
          type: 'HOUSING_REFUND',
          payload: JSON.stringify({ message: `คืนเงินจริง ${Number(refund.amount).toLocaleString()} บาทแล้ว` }),
          status: 'SENT',
          sentAt: new Date(),
        } });
        return { refund, userId: source.userId, notification };
      }, { timeout: 15000 });
      kept = result.refund.proofPath === proofPath;
      if (result.notification) publishNotificationAlert(result.notification);
      publishAdminAlert(result.refund.id, 'HOUSING_REFUND', 'บันทึกคืนเงินจริงตามคำขอแล้ว', 'COMPLETE');
      publishResidentStatus(result.userId, 0, 'CREDIT_UPDATED');
      return { id: result.refund.id, amount: Number(result.refund.amount), reference: result.refund.reference, createdAt: result.refund.createdAt };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError('เลขอ้างอิงหรือหลักฐานนี้ถูกใช้บันทึกคืนเงินแล้ว', 409);
      throw error;
    } finally { if (!kept) await fs.unlink(absolute).catch(() => undefined); }
  }

  static async reject(draftId: number, requestId: number, adminId: number, note: string) {
    const normalizedNote = note.trim();
    if (!normalizedNote || normalizedNote.length > 500) throw new AppError('กรุณาระบุเหตุผลที่ไม่อนุมัติไม่เกิน 500 ตัวอักษร', 400);
    const result = await prisma.$transaction(async tx => {
      const source = await tx.housingApplicationDraft.findUnique({ where: { id: draftId } });
      if (!source) throw new AppError('ไม่พบใบสมัคร', 404);
      const draft = await HousingDraftService.locked(tx, source.userId);
      const actor = await tx.user.findUnique({ where: { id: adminId }, select: { role: true } });
      if (actor?.role !== 'ADMIN') throw new AppError('ไม่มีสิทธิ์จัดการคำขอคืนเงิน', 403);
      const request = await tx.housingRefundRequest.findUnique({ where: { id: requestId } });
      if (!request || request.draftId !== draftId) throw new AppError('ไม่พบคำขอคืนเงิน', 404);
      if (request.status !== 'PENDING') throw new AppError('คำขอนี้ถูกจัดการไปแล้ว กรุณาโหลดสถานะล่าสุด', 409);
      const updated = await tx.housingRefundRequest.update({ where: { id: requestId }, data: {
        status: 'REJECTED', adminNote: normalizedNote, resolvedById: adminId, resolvedAt: new Date(),
      } });
      await tx.housingApplicationDraft.update({ where: { id: draft.id }, data: { version: { increment: 1 } } });
      return { request: updated, userId: source.userId };
    }, { timeout: 15000 });
    publishResidentStatus(result.userId, 0, 'CREDIT_UPDATED');
    return { id: result.request.id, status: result.request.status, adminNote: result.request.adminNote, resolvedAt: result.request.resolvedAt };
  }

  static async proof(refundId: number) {
    const refund = await prisma.housingRefund.findUnique({ where: { id: refundId } });
    if (!refund) throw new AppError('ไม่พบหลักฐานคืนเงิน', 404);
    const root = path.resolve(process.env.UPLOAD_ROOT || 'uploads/private', 'housing-refunds');
    const filename = path.basename(refund.proofPath);
    if (!/^[a-f0-9-]+\.(png|jpg|webp)$/.test(filename)) throw new AppError('หลักฐานมีเส้นทางไม่ถูกต้อง', 409);
    return path.join(root, filename);
  }
}
