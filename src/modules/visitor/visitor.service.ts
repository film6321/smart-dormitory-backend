import { calculateAge } from '../../shared/date-utils';
import NotificationService from '../notifications/notification.service';
import { AppError } from '../../middlewares/error-handler';
import { VisitorRepository } from './visitor.repository';
import { Prisma } from '@prisma/client';
import { prisma } from '../../database/db';
import { publishAdminAlert } from '../../realtime/notification-gateway';
import { OcrService } from '../ocr/ocr.service';
import { acquireLock, releaseLock } from '../../shared/redis';
import { createHash } from 'node:crypto';

const maskCitizenId = (citizenId?: string | null): string | undefined => {
  if (!citizenId) return undefined;
  const normalized = citizenId.replace(/\D/g, '');
  if (normalized.length < 5) return '*'.repeat(normalized.length);
  return `${normalized.slice(0, 3)}${'*'.repeat(Math.max(normalized.length - 5, 0))}${normalized.slice(-2)}`;
};

const normalizeThaiIdentityName = (value: string): string => {
  const normalized = value.normalize('NFC').replace(/[\s.]/gu, '');
  return normalized.replace(/^(?:เด็กชาย|เด็กหญิง|นางสาว|นาย|นาง|ดช|ดญ|นส)/u, '');
};

export interface RegisterVisitorInput {
  guestName: string;
  phone?: string;
  citizenId?: string;
  relationship?: string;
  age?: number;
  birthDate?: string;
  address?: string;
  idCardImagePath?: string;
  purpose?: string;
  roomId?: number;
  roomNumber?: string;
  requestedTenantName: string;
  idCardVerificationId?: number;
  expectedEntryTime?: Date;
  pdpaConsent: boolean;
}

export class VisitorService {
  private static visitProgress(logs: Array<{ eventType: string; createdAt: Date }> = []) {
    const entry = logs.find(log => log.eventType === 'DOOR_ACCESS_GRANTED');
    const completion = logs.find(log => log.eventType === 'VISIT_COMPLETED');
    return { visitStage: completion ? 'COMPLETED' : entry ? 'ADMITTED' : 'WAITING',
      accessGrantedAt: entry?.createdAt ?? null, visitCompletedAt: completion?.createdAt ?? null };
  }

  static async recordVisitAccess(id: number, action: 'GRANT_ENTRY' | 'COMPLETE_VISIT', adminId: number) {
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Visitor" WHERE id = ${id} FOR UPDATE`;
      const visitor = await tx.visitor.findUnique({ where: { id }, include: { logs: { orderBy: { createdAt: 'asc' } } } });
      if (!visitor) throw new AppError('ไม่พบคำขอผู้มาติดต่อ', 404);
      const progress = this.visitProgress(visitor.logs);
      if (visitor.status !== 'REGISTERED') throw new AppError('สถานะคำขอไม่อนุญาตให้บันทึกการเข้าพบ', 409);
      if (action === 'GRANT_ENTRY') {
        if (progress.visitStage === 'COMPLETED') throw new AppError('จบการเข้าพบแล้ว กรุณาส่งคำขอใหม่', 409);
        if (progress.visitStage === 'ADMITTED') return { changed: false, progress };
        if (!visitor.expiresAt || visitor.expiresAt <= new Date()) throw new AppError('คำขอหมดอายุแล้ว', 409);
      } else {
        if (progress.visitStage === 'COMPLETED') return { changed: false, progress };
        if (progress.visitStage !== 'ADMITTED') throw new AppError('ต้องบันทึกอนุญาตเข้าก่อนจบการเข้าพบ', 409);
      }
      const log = await tx.visitorLog.create({ data: { visitorId: id,
        eventType: action === 'GRANT_ENTRY' ? 'DOOR_ACCESS_GRANTED' : 'VISIT_COMPLETED',
        note: `Admin UserId=${adminId}: ${action === 'GRANT_ENTRY' ? 'ตรวจชื่อผู้เช่าและห้องแล้ว บันทึกอนุญาตเข้าโดยเจ้าหน้าที่' : 'เจ้าหน้าที่ยืนยันออกและจบการเข้าพบ'}; manual record, not hardware confirmation`,
      } });
      return { changed: true, progress: this.visitProgress([...visitor.logs, log]) };
    });
    if (result.changed) publishAdminAlert(id, action === 'GRANT_ENTRY' ? 'VISITOR_ENTRY_GRANTED' : 'VISITOR_COMPLETED',
      action === 'GRANT_ENTRY' ? 'เจ้าหน้าที่บันทึกอนุญาตผู้มาติดต่อเข้า' : 'เจ้าหน้าที่บันทึกจบการเข้าพบ', result.progress.visitStage);
    return { id, ...result.progress, recordedManually: true };
  }
  static async getVisitorById(id: number) {
    return VisitorRepository.getVisitorById(id);
  }

  static async scanVisitorIdCard(imageBase64: string) {
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      throw new AppError('กรุณาแนบรูปภาพบัตรประชาชน', 400);
    }

    const ocrResult = await OcrService.verifyIdCard(imageBase64);

    return {
      verificationId: ocrResult.verificationId,
      cardDetected: ocrResult.confidence.idDetected,
      isThaiIdCard: ocrResult.isThaiIdCard,
      guestName: ocrResult.fullNameTh || '',
      citizenId: ocrResult.citizenId || '',
      citizenIdMasked: ocrResult.citizenIdMasked || (ocrResult.citizenId ? maskCitizenId(ocrResult.citizenId) : ''),
      birthDate: ocrResult.birthDateTh || '',
      age: ocrResult.age,
      address: ocrResult.address || '',
      idCardImagePath: ocrResult.imagePath || '',
      reason: ocrResult.reason,
    };
  }

  static async registerVisitor(data: RegisterVisitorInput, idempotencyKey?: string) {
    if (!idempotencyKey) return this.createVisitorRequest(data);
    if (idempotencyKey.length > 200) throw new AppError('Idempotency-Key is too long', 400);
    if (data.expectedEntryTime && !Number.isFinite(data.expectedEntryTime.getTime())) throw new AppError('เวลานัดหมายไม่ถูกต้อง', 400);
    const requestKey = `visitor-registration:${createHash('sha256').update(idempotencyKey).digest('hex')}`;
    const requestHash = createHash('sha256').update(JSON.stringify([
      normalizeThaiIdentityName(data.guestName || ''), data.citizenId?.replace(/\D/g, ''),
      data.roomNumber?.trim(), data.requestedTenantName?.trim(), data.address?.trim(),
      data.idCardImagePath?.trim(), Number(data.idCardVerificationId), data.phone?.trim(),
      data.relationship?.trim(), data.age == null ? null : Number(data.age), data.birthDate?.trim(),
      data.purpose?.trim(), data.expectedEntryTime?.toISOString(), Boolean(data.pdpaConsent),
    ])).digest('hex');
    const lockKey = `lock:${requestKey}`;
    if (!await acquireLock(lockKey, 30_000)) {
      throw new AppError('คำขอลงทะเบียนนี้กำลังดำเนินการอยู่ กรุณารอสักครู่', 409);
    }
    try {
      return await this.createVisitorRequest(data, requestKey, requestHash);
    } finally {
      await releaseLock(lockKey);
    }
  }

  private static async findRegisteredRequest(requestKey: string, requestHash: string, db: Prisma.TransactionClient | typeof prisma) {
    const record = await db.systemSetting.findUnique({ where: { key: requestKey } });
    if (!record) return null;
    if (record.category !== 'VISITOR_IDEMPOTENCY') throw new AppError('Invalid visitor request record', 409);
    const saved = JSON.parse(record.value) as { requestHash: string; visitorId: number };
    if (saved.requestHash !== requestHash) throw new AppError('Idempotency-Key นี้ใช้กับคำขออื่นแล้ว', 409);
    const visitor = await db.visitor.findUnique({ where: { id: saved.visitorId }, include: {
      room: { select: { roomNumber: true } }, tenant: { select: { fullName: true, studentId: true } },
    } });
    if (!visitor) throw new AppError('ข้อมูลคำขอเดิมถูกล้างแล้ว กรุณาเริ่มคำขอใหม่', 409);
    return visitor;
  }

  private static async createVisitorRequest(data: RegisterVisitorInput, requestKey?: string, requestHash?: string) {
    if (requestKey && requestHash) {
      const previous = await this.findRegisteredRequest(requestKey, requestHash, prisma);
      if (previous) return previous;
    }
    if (!data.pdpaConsent) {
      throw new AppError('กรุณายินยอมข้อตกลงการประมวลผลข้อมูลส่วนบุคคล (PDPA) ก่อนดำเนินการ', 400);
    }

    const guestName = data.guestName?.trim();
    const address = data.address?.trim();
    const roomNumber = data.roomNumber?.trim();
    const requestedTenantName = data.requestedTenantName?.trim();
    const cleanCitizenId = data.citizenId?.replace(/\D/g, '');
    const idCardImagePath = data.idCardImagePath?.trim();

    if (!guestName || guestName.length < 2) throw new AppError('กรุณาระบุชื่อ-นามสกุลของผู้มาติดต่อ', 400);
    if (!address) throw new AppError('กรุณาระบุที่อยู่ตามบัตรประชาชน', 400);
    if (!cleanCitizenId || !/^\d{13}$/.test(cleanCitizenId)) throw new AppError('กรุณาระบุเลขบัตรประชาชน 13 หลัก', 400);
    if (!roomNumber) throw new AppError('กรุณาระบุเลขห้องที่ต้องการติดต่อ', 400);
    if (!requestedTenantName) throw new AppError('กรุณาระบุชื่อผู้เช่าที่ต้องการพบ', 400);
    if (!idCardImagePath || !data.idCardVerificationId) {
      throw new AppError('กรุณาอัปโหลดและยืนยันบัตรประชาชนด้วย OCR ก่อนส่งคำขอ', 400);
    }

    const verifiedCard = await prisma.idCardVerification.findUnique({
      where: { id: Number(data.idCardVerificationId) },
      select: { imagePath: true, isThaiIdCard: true, citizenIdMasked: true, citizenIdHash: true, fullNameTh: true },
    });
    if (!verifiedCard?.isThaiIdCard || verifiedCard.imagePath !== idCardImagePath) {
      throw new AppError('ไม่พบผล OCR ที่ยืนยันบัตรประชาชนฉบับนี้', 400);
    }

    if (!verifiedCard.citizenIdHash || verifiedCard.citizenIdHash !== createHash('sha256').update(cleanCitizenId).digest('hex')) {
      throw new AppError('เลขบัตรประชาชนไม่ตรงกับผลตรวจ OCR หรือผลตรวจเก่า กรุณาสแกนบัตรใหม่', 400);
    }

    const citizenId = cleanCitizenId;
    const citizenIdMasked = maskCitizenId(cleanCitizenId);
    if (verifiedCard.citizenIdMasked && verifiedCard.citizenIdMasked !== citizenIdMasked) {
      throw new AppError('เลขบัตรประชาชนไม่ตรงกับผลตรวจ OCR กรุณาตรวจสอบบัตรอีกครั้ง', 400);
    }

    const ocrFullName = verifiedCard.fullNameTh?.trim();
    if (!ocrFullName) {
      throw new AppError('ไม่พบชื่อจาก OCR กรุณาสแกนบัตรประชาชนใหม่', 400);
    }
    if (normalizeThaiIdentityName(guestName) !== normalizeThaiIdentityName(ocrFullName)) {
      throw new AppError('ชื่อผู้มาติดต่อไม่ตรงกับชื่อบนบัตรประชาชน กรุณาตรวจสอบชื่อหรือสแกนบัตรใหม่', 400);
    }

    const room = await prisma.room.findUnique({ where: { roomNumber } });
    if (!room) throw new AppError('ไม่พบเลขห้องนี้ในระบบ กรุณาตรวจสอบและกรอกใหม่', 400);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    if (data.expectedEntryTime && data.expectedEntryTime > expiresAt) throw new AppError('เวลานัดหมายต้องอยู่ภายใน 24 ชั่วโมงหลังส่งคำขอ', 400);

    const birthDate = data.birthDate?.trim();
    const derivedAge = birthDate ? calculateAge(birthDate, now) : undefined;
    if (birthDate && (derivedAge === undefined || derivedAge < 1 || derivedAge > 120)) throw new AppError('กรุณาระบุวันเกิดที่ถูกต้อง', 400);
    const createData: Prisma.VisitorCreateInput = {
      guestName: ocrFullName,
      requestedTenantName,
      phone: data.phone?.trim() || undefined,
      citizenId,
      citizenIdMasked,
      relationship: data.relationship?.trim() || undefined,
      age: birthDate ? derivedAge : (data.age !== undefined && data.age !== null ? Number(data.age) : undefined),
      birthDate: data.birthDate?.trim() || undefined,
      address,
      idCardImagePath,
      purpose: data.purpose?.trim() || undefined,
      expectedEntryTime: data.expectedEntryTime,
      status: 'REGISTERED',
      pdpaConsent: true,
      pdpaConsentAt: now,
      expiresAt,
    };

    createData.room = { connect: { id: room.id } };

    const transaction = await prisma.$transaction(async (tx) => {
      if (requestKey && requestHash) {
        // Durable serialization also covers Redis expiry or retries after a restart.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestKey}))`;
        const previous = await this.findRegisteredRequest(requestKey, requestHash, tx);
        if (previous) return { visitor: previous, created: false };
      }
      // Serialize retries even when the browser supplies a new key after refresh/OCR.
      const pendingKey = createHash('sha256').update(JSON.stringify([citizenId, room.id, requestedTenantName])).digest('hex');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pendingKey}))`;
      // Share the OCR deletion lock: evidence cannot disappear between validation and commit.
      await tx.$queryRaw`SELECT id FROM "IdCardVerification" WHERE id = ${Number(data.idCardVerificationId)} FOR UPDATE`;
      const currentCard = await tx.idCardVerification.findUnique({ where: { id: Number(data.idCardVerificationId) } });
      if (!currentCard || currentCard.imagePath !== idCardImagePath) {
        throw new AppError('ผลตรวจบัตรถูกลบแล้ว กรุณาสแกนบัตรใหม่', 409);
      }
      const pending = await tx.visitor.findFirst({
        where: { citizenId, roomId: room.id, requestedTenantName, status: 'REGISTERED',
          OR: [{ expiresAt: { gt: new Date() } }, { logs: { some: { eventType: 'DOOR_ACCESS_GRANTED' } } }],
          logs: { none: { eventType: 'VISIT_COMPLETED' } } },
        orderBy: { createdAt: 'desc' },
        include: { room: { select: { roomNumber: true } }, tenant: { select: { fullName: true, studentId: true } } },
      });
      if (pending) {
        if (requestKey && requestHash) await tx.systemSetting.create({ data: {
          key: requestKey, category: 'VISITOR_IDEMPOTENCY', value: JSON.stringify({ requestHash, visitorId: pending.id }),
        } });
        return { visitor: pending, created: false };
      }
      const created = await tx.visitor.create({
        data: createData,
        include: {
          room: { select: { roomNumber: true } },
          tenant: { select: { fullName: true, studentId: true } },
        },
      });

      // Visitor requests are reviewed in person; do not generate a public QR containing PII.
      const registeredVisitor = created;

      await tx.visitorLog.create({
        data: {
          visitorId: created.id,
          eventType: 'REGISTERED',
          note: 'ผู้มาติดต่อลงทะเบียนสำเร็จ (มีอายุ 24 ชั่วโมง)',
        },
      });

      if (requestKey && requestHash) {
        await tx.systemSetting.create({ data: {
          key: requestKey, category: 'VISITOR_IDEMPOTENCY',
          value: JSON.stringify({ requestHash, visitorId: created.id }),
        } });
      }
      return { visitor: registeredVisitor, created: true };
    });
    const visitor = transaction.visitor;
    if (!transaction.created) return visitor;

    if (visitor.tenantId) {
      try {
        const notificationService = new NotificationService();
        await notificationService.scheduleNotification({
          tenantId: visitor.tenantId,
          channel: 'SMS',
          type: 'VISITOR_ARRIVAL',
          payload: JSON.stringify({ message: `Visitor ${visitor.guestName} registered`, visitorId: visitor.id }),
        });
      } catch {
        // Notification failure shouldn't rollback registration
      }
    }

    publishAdminAlert(visitor.id, 'VISITOR_REGISTERED', `มีผู้มาติดต่อลงทะเบียนใหม่: ${visitor.guestName}`, 'REGISTERED');

    return visitor;
  }

  static async getVisitorPass(id: number) {
    const visitor = await VisitorRepository.getVisitorById(id);

    if (!visitor) {
      throw new AppError('ไม่พบข้อมูลการลงทะเบียนของผู้มาติดต่อ', 404);
    }

    const now = new Date();
    const isExpired = visitor.expiresAt ? now > visitor.expiresAt : false;
    const progress = this.visitProgress(visitor.logs);
    const canCancel = progress.visitStage === 'WAITING' && (visitor.status === 'REGISTERED' || visitor.status === 'APPROVED' || visitor.status === 'VERIFYING') && !isExpired;

    return {
      id: visitor.id,
      guestName: visitor.guestName,
      phone: visitor.phone,
      citizenIdMasked: visitor.citizenIdMasked,
      relationship: visitor.relationship,
      age: visitor.age,
      birthDate: visitor.birthDate,
      address: visitor.address,
      purpose: visitor.purpose,
      roomNumber: visitor.room?.roomNumber,
      requestedTenantName: visitor.requestedTenantName,
      expectedEntryTime: visitor.expectedEntryTime,
      status: visitor.status,
      expiresAt: visitor.expiresAt,
      qrCodeData: visitor.qrCodeData,
      isExpired,
      canCancel,
      createdAt: visitor.createdAt,
      ...progress,
    };
  }

  static async cancelVisitor(id: number, reason?: string) {
    const visitor = await VisitorRepository.getVisitorById(id);

    if (!visitor) {
      throw new AppError('ไม่พบข้อมูลการลงทะเบียนของผู้มาติดต่อ', 404);
    }

    if (visitor.status === 'CANCELLED') {
      return visitor;
    }

    if (visitor.status === 'CHECKED_IN' || visitor.status === 'CHECKED_OUT') {
      throw new AppError('ไม่สามารถยกเลิกได้เนื่องจากผู้มาติดต่อได้ทำการเช็คอินเข้าหอพักแล้ว', 409);
    }

    const now = new Date();
    if (visitor.expiresAt && now > visitor.expiresAt) {
      throw new AppError('ไม่สามารถยกเลิกได้เนื่องจากคำขอหมดอายุแล้ว (เกินกำหนด 24 ชั่วโมง)', 409);
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Visitor" WHERE id = ${id} FOR UPDATE`;
      if (await tx.visitorLog.findFirst({ where: { visitorId: id, eventType: 'DOOR_ACCESS_GRANTED' } })) {
        throw new AppError('อนุญาตเข้าแล้ว กรุณาบันทึกจบการเข้าพบแทนการยกเลิก', 409);
      }
      const result = await tx.visitor.updateMany({
        where: { id, status: visitor.status, expiresAt: { gt: now } },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
      if (result.count !== 1) {
        throw new AppError('คำขอหมดอายุหรือสถานะเปลี่ยนแล้ว ไม่สามารถยกเลิกได้', 409);
      }
      const cancelled = await tx.visitor.findUnique({
        where: { id },
        include: {
          room: { select: { roomNumber: true } },
          tenant: { select: { fullName: true, studentId: true } },
        },
      });
      if (!cancelled) throw new AppError('ไม่พบคำขอผู้มาติดต่อ', 404);

      await tx.visitorLog.create({
        data: {
          visitorId: id,
          eventType: 'CANCELLED',
          note: reason || 'ผู้มาติดต่อขอยกเลิกคำขอลงทะเบียน',
        },
      });

      return cancelled;
    });

    publishAdminAlert(updated.id, 'VISITOR_CANCELLED', `ผู้มาติดต่อ ${updated.guestName} ยกเลิกการลงทะเบียน`, 'CANCELLED');

    return updated;
  }

  static async expirePendingVisitors(now = new Date(), batchSize = 100) {
    const candidates = await prisma.visitor.findMany({
      where: { status: 'REGISTERED', expiresAt: { lte: now }, logs: { none: { eventType: 'DOOR_ACCESS_GRANTED' } } },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: Math.max(1, Math.min(batchSize, 500)),
    });
    let expiredCount = 0;
    for (const { id } of candidates) {
      const expired = await prisma.$transaction(async (tx) => {
        await tx.$queryRawUnsafe('SELECT id FROM "Visitor" WHERE id = $1 FOR UPDATE', id);
        const current = await tx.visitor.findUnique({ where: { id }, select: { status: true, expiresAt: true } });
        if (current?.status !== 'REGISTERED' || !current.expiresAt || current.expiresAt > now) return false;
        const successfulAccess = await tx.visitorLog.findFirst({
          where: { visitorId: id, eventType: 'DOOR_ACCESS_GRANTED' },
          select: { id: true },
        });
        if (successfulAccess) return false;
        const result = await tx.visitor.updateMany({
          where: { id, status: 'REGISTERED', expiresAt: { lte: now } },
          data: { status: 'EXPIRED' },
        });
        if (result.count !== 1) return false;
        await tx.visitorLog.create({
          data: { visitorId: id, eventType: 'EXPIRED', note: 'No successful visit within 24 hours of registration' },
        });
        return true;
      });
      if (expired) expiredCount += 1;
    }
    return expiredCount;
  }

  static async listVisitors() {
    const visitors = await VisitorRepository.listVisitors();
    return visitors.map(visitor => ({ ...visitor, ...this.visitProgress(visitor.logs) }));
  }

  static async updateVisitorStatus(id: number, status: string) {
    if (status !== 'CANCELLED') {
      throw new AppError('Current visitor flow does not allow status approval or check-in transitions', 409);
    }
    return VisitorService.cancelVisitor(id, 'Cancelled by administrator');
  }

}

