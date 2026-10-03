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
  tenantId?: number;
  tenantName?: string;
  idCardVerificationId?: number;
  expectedEntryTime?: Date;
  pdpaConsent: boolean;
}

export class VisitorService {
  static async getVisitorById(id: number) {
    return VisitorRepository.getVisitorById(id);
  }

  static async scanVisitorIdCard(imageBase64: string) {
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      throw new AppError('กรุณาแนบรูปภาพบัตรประชาชน', 400);
    }

    const ocrResult = await OcrService.verifyIdCard(imageBase64);

    return {
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
    const lockKey = `lock:visitor-registration:${createHash('sha256').update(idempotencyKey).digest('hex')}`;
    if (!await acquireLock(lockKey, 30_000)) {
      throw new AppError('คำขอลงทะเบียนนี้กำลังดำเนินการอยู่ กรุณารอสักครู่', 409);
    }
    try {
      return await this.createVisitorRequest(data);
    } finally {
      await releaseLock(lockKey);
    }
  }

  private static async createVisitorRequest(data: RegisterVisitorInput) {
    if (!data.pdpaConsent) {
      throw new AppError('กรุณายินยอมข้อตกลงการประมวลผลข้อมูลส่วนบุคคล (PDPA) ก่อนดำเนินการ', 400);
    }

    const guestName = data.guestName?.trim();
    const address = data.address?.trim();
    const roomNumber = data.roomNumber?.trim();
    const tenantName = data.tenantName?.trim();
    const cleanCitizenId = data.citizenId?.replace(/\D/g, '');
    const idCardImagePath = data.idCardImagePath?.trim();

    if (!guestName || guestName.length < 2) throw new AppError('กรุณาระบุชื่อ-นามสกุลของผู้มาติดต่อ', 400);
    if (!address) throw new AppError('กรุณาระบุที่อยู่ตามบัตรประชาชน', 400);
    if (!cleanCitizenId || !/^\d{13}$/.test(cleanCitizenId)) throw new AppError('กรุณาระบุเลขบัตรประชาชน 13 หลัก', 400);
    if (!roomNumber) throw new AppError('กรุณาระบุเลขห้องที่ต้องการติดต่อ', 400);
    if (!tenantName) throw new AppError('กรุณาระบุชื่อผู้เช่าที่ต้องการติดต่อ', 400);
    if (!idCardImagePath || !data.idCardVerificationId) {
      throw new AppError('กรุณาอัปโหลดและยืนยันบัตรประชาชนด้วย OCR ก่อนส่งคำขอ', 400);
    }

    const verifiedCard = await prisma.idCardVerification.findUnique({
      where: { id: Number(data.idCardVerificationId) },
      select: { imagePath: true, isThaiIdCard: true, citizenIdMasked: true },
    });
    if (!verifiedCard?.isThaiIdCard || verifiedCard.imagePath !== idCardImagePath) {
      throw new AppError('ไม่พบผล OCR ที่ยืนยันบัตรประชาชนฉบับนี้', 400);
    }

    const citizenId = cleanCitizenId;
    const citizenIdMasked = maskCitizenId(cleanCitizenId);
    if (verifiedCard.citizenIdMasked && verifiedCard.citizenIdMasked !== citizenIdMasked) {
      throw new AppError('เลขบัตรประชาชนไม่ตรงกับผลตรวจ OCR กรุณาตรวจสอบบัตรอีกครั้ง', 400);
    }

    const room = await prisma.room.findUnique({ where: { roomNumber } });
    if (!room) throw new AppError('ไม่พบเลขห้องนี้ในระบบ กรุณาตรวจสอบและกรอกใหม่', 400);

    const tenant = await prisma.tenant.findFirst({
      where: {
        roomId: room.id,
        fullName: { equals: tenantName, mode: 'insensitive' },
        isActive: true,
        status: { in: ['APPROVED', 'ACTIVE'] },
      },
      select: { id: true, fullName: true },
    });
    if (!tenant) throw new AppError('ไม่พบชื่อผู้เช่าที่ระบุในห้องนี้ กรุณาตรวจสอบชื่อและเลขห้อง', 400);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const createData: Prisma.VisitorCreateInput = {
      guestName,
      phone: data.phone?.trim() || undefined,
      citizenId,
      citizenIdMasked,
      relationship: data.relationship?.trim() || undefined,
      age: data.age !== undefined && data.age !== null ? Number(data.age) : undefined,
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
    createData.tenant = { connect: { id: tenant.id } };

    const visitor = await prisma.$transaction(async (tx) => {
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

      return registeredVisitor;
    });

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
    const canCancel = (visitor.status === 'REGISTERED' || visitor.status === 'APPROVED' || visitor.status === 'VERIFYING') && !isExpired;

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
      tenantName: visitor.tenant?.fullName,
      expectedEntryTime: visitor.expectedEntryTime,
      status: visitor.status,
      expiresAt: visitor.expiresAt,
      qrCodeData: visitor.qrCodeData,
      isExpired,
      canCancel,
      createdAt: visitor.createdAt,
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
      where: { status: 'REGISTERED', expiresAt: { lte: now } },
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
    return VisitorRepository.listVisitors();
  }

  static async updateVisitorStatus(id: number, status: string) {
    if (status !== 'CANCELLED') {
      throw new AppError('Current visitor flow does not allow status approval or check-in transitions', 409);
    }
    return VisitorService.cancelVisitor(id, 'Cancelled by administrator');
  }

}

