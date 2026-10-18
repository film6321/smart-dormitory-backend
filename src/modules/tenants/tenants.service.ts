import { FaceCleanupService } from '../face-verification/face-cleanup.service';
import { AccountRetentionService } from '../users/account-retention.service';
import fs from 'fs/promises';
import { createHash } from 'crypto';
import { HousingPaymentService } from './housing-payment.service';
import { HousingDraftService } from './housing-draft.service';
import { OcrService } from '../ocr/ocr.service';
import { isFilledText, normalizeThaiNameForComparison, validateHousingApplication } from './tenants.dto';
import { logger } from '../../logger';
import { prisma, type DbClient } from '../../database/db';
import type { Prisma, Tenant } from '@prisma/client';
import { AppError } from '../../middlewares/error-handler';
import { ROOM_RESERVATION_FILTER, TenantsRepository } from './tenants.repository';
import path from 'path';
import { getContractTerms, getSettingValue } from '../settings/settings.service';
import { AcademicService } from '../settings/academic.service';
import { calculateAge } from '../../shared/date-utils';
import { publishAdminAlert, publishResidentStatus } from '../../realtime/notification-gateway';

export interface CreateTenantInput {
  userId?: number | null;
  roomId?: number | null;
  fullName?: string;
  phone?: string;
  email?: string;
  studentId?: string;
  course?: string;
  yearLevel?: string;
  citizenId?: string;
  address?: string;
  birthDate?: string;
  emergencyContact?: string;
  emergencyName?: string;
  emergencyRelation?: string;
  preferredRoomType?: string;
  notes?: string;
  contractData?: string;
  status?: string;
  checkInDate?: Date | string | null;
  checkOutDate?: Date | string | null;
  isActive?: boolean;
}

export interface SubmitApplicationInput {
  personalInformation: {
    fullName: string;
    studentId: string;
    course: string;
    facultyId?: string;
    yearLevel: string;
    emailAddress?: string;
    citizenId?: string;
    address?: string;
    birthDate?: string;
  };
  emergencyContact: {
    emergencyName: string;
    relationship: string;
    emergencyNumber: string;
  };
  roomPreference: {
    preferredRoomType: string;
    roomNumber?: string;
    isRandomRoom?: boolean;
    notes?: string;
  };
  ocrData?: {
    citizenId?: string;
    address?: string;
    birthDate?: string;
    birthDateTh?: string;
    fullNameTh?: string;
    verificationId?: number;
  };
  idCardImagePath?: string;
  paymentSlipPath?: string;
  paymentId?: number;
  contractAccepted?: boolean;
  excessAccepted?: boolean;
  contractData?: Record<string, unknown>;
  userId?: number;
}

export interface UploadedFile {
  mimetype: string;
  buffer: Buffer;
  originalname?: string;
  size?: number;
}

export class TenantsService {
  private static async getMaxOccupants() {
    return Number(await getSettingValue('maxOccupants')) || 4;
  }

  private static assertRoomHasCapacity(room: { capacity: number; tenants?: readonly { id: number }[] }, maxOccupants: number) {
    const configuredCapacity = Math.min(room.capacity || maxOccupants, maxOccupants);
    if ((room.tenants?.length ?? 0) >= configuredCapacity) {
      throw new AppError(`ห้องพักเต็มตามข้อกำหนด ${configuredCapacity} คน`, 409);
    }
  }

  private static async claimUserVersion(db: Prisma.TransactionClient, userId: number) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { version: true } });
    if (!user) throw new AppError('User not found', 404);
    const claimed = await db.user.updateMany({
      where: { id: userId, version: user.version }, data: { version: { increment: 1 } },
    });
    if (claimed.count !== 1) throw new AppError('ข้อมูลผู้พักถูกแก้ไขพร้อมกัน กรุณาลองใหม่', 409);
  }

  private static async refreshRoomStatus(db: Prisma.TransactionClient, roomId: number, maxOccupants: number) {
    const room = await db.room.findUnique({ where: { id: roomId } });
    if (!room || !['AVAILABLE', 'OCCUPIED'].includes(room.status)) return;
    const count = await db.tenant.count({ where: { ...ROOM_RESERVATION_FILTER, roomId } });
    await db.room.update({
      where: { id: roomId },
      data: { status: count >= Math.min(room.capacity, maxOccupants) ? 'OCCUPIED' : 'AVAILABLE' },
    });
  }

  static async listTenants(db?: DbClient) {
    const tenants = await TenantsRepository.listTenants(undefined, undefined, db);
    return tenants.map((tenant) => ({
      ...tenant,
      age: calculateAge(tenant.birthDate),
    }));
  }

  static async getTenantById(id: number, db?: DbClient) {
    const tenant = await TenantsRepository.getTenantById(id, db);
    if (!tenant) return null;
    return {
      ...tenant,
      age: calculateAge(tenant.birthDate),
    };
  }

  static async getTenantByUserId(userId: number, db?: DbClient) {
    const tenant = await TenantsRepository.getTenantByUserId(userId, db);
    if (!tenant) return null;
    const { faceRevokedAt, _count, accessLogs, ...publicUser } = tenant.user ?? {};
    const faceEnrollmentComplete = !faceRevokedAt && (_count?.faceEnrollmentPhotos ?? 0) >= 5
      && Boolean(accessLogs?.some(log => log.path === `/api/tenants/${tenant.id}/face-enrollment/complete`));
    return { ...tenant, user: tenant.user ? publicUser : null, faceEnrollmentComplete, age: calculateAge(tenant.birthDate) };
  }

  static async completeFaceEnrollment(userId: number, db?: DbClient) {
    return TenantsRepository.completeFaceEnrollment(userId, db);
  }

  static resolveTenantDocumentPath(documentPath: string | null | undefined) {
    if (!documentPath) {
      throw new AppError('Document not found', 404);
    }

    const uploadRoot = path.resolve(process.env.UPLOAD_ROOT || path.join(process.cwd(), 'uploads/private'));
    const normalizedPath = documentPath.replace(/^uploads[\\/ ]*private[\\/]?/u, '');
    const resolvedPath = path.resolve(uploadRoot, normalizedPath);

    if (resolvedPath !== uploadRoot && !resolvedPath.startsWith(`${uploadRoot}${path.sep}`)) {
      throw new AppError('Invalid document path', 400);
    }

    return resolvedPath;
  }

  static async verifyIdentity(idCardFile: UploadedFile, userId: number) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(idCardFile.mimetype) || idCardFile.buffer.length > 10 * 1024 * 1024) throw new AppError('บัตรประชาชนต้องเป็นรูป JPG, PNG หรือ WEBP ไม่เกิน 10 MB', 400);
    const account = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    if (!account) throw new AppError('User not found', 404);
    let result: Awaited<ReturnType<typeof OcrService.verifyIdCard>>;
    try {
      result = await OcrService.verifyIdCard(
        `data:${idCardFile.mimetype};base64,${idCardFile.buffer.toString('base64')}`, { userId },
      );
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.warn({ err: error, userId }, 'Housing application OCR unavailable');
      throw new AppError('ไม่สามารถตรวจสอบบัตรประชาชนได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง', 503);
    }
    if (!result.confidence.idDetected) {
      throw new AppError('ภาพนี้ไม่ผ่านการตรวจว่าเป็นบัตรประชาชน กรุณาอัปโหลดบัตรประชาชนใหม่', 422);
    }
    if (!result.verificationId || !result.imagePath) {
      throw new AppError('ไม่สามารถบันทึกผลตรวจบัตรประชาชนได้ กรุณาลองใหม่', 503);
    }
    const readable = (value: unknown) => (isFilledText(value) && !value.includes('*') ? value.trim() : '');
    return {
      registeredPhone: account.phone?.trim() ?? '',
      idCardImagePath: result.imagePath,
      ocrData: {
        verificationId: result.verificationId,
        cardDetected: true,
        isThaiIdCard: result.isThaiIdCard,
        citizenId: result.confidence.idChecksumValid && /^\d{13}$/.test(result.citizenId || '') ? result.citizenId : '',
        fullNameTh: readable(result.fullNameTh),
        birthDateTh: readable(result.birthDateTh),
        age: result.age ?? null,
        address: readable(result.address),
      },
    };
  }

  static async verifyHousingPayment(paymentSlipFile: UploadedFile, userId: number, roomNumber: string, verificationId: number, useDraft = false) {
    const [account, verification] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { phone: true } }),
      prisma.idCardVerification.findUnique({ where: { id: verificationId } }),
    ]);
    if (!account) throw new AppError('User not found', 404);
    if (!verification || verification.userId !== userId || !verification.idDetected || !verification.imagePath) {
      throw new AppError('กรุณาตรวจบัตรประชาชนของบัญชีนี้ให้ผ่านก่อนตรวจสลิป', 422);
    }
    const payment = useDraft
      ? await HousingPaymentService.verifyDraftSlip(roomNumber, userId, paymentSlipFile, verification.id)
      : await HousingPaymentService.verifySlip(roomNumber, userId, paymentSlipFile, verification.id);
    return { registeredPhone: account.phone?.trim() ?? '', idCardImagePath: verification.imagePath,
      paymentSlipPath: payment.slipPath!, paymentVerification: { id: payment.id, status: 'PAID' as const, amount: Number(payment.amount) } };
  }

  static async uploadDocuments(idCardFile: UploadedFile, paymentSlipFile: UploadedFile, userId: number, roomNumber: string) {
    await HousingDraftService.assertEditable(userId);
    const identity = await this.verifyIdentity(idCardFile, userId);
    await HousingDraftService.bindIdentity(userId, identity.ocrData.verificationId!);
    const payment = await this.verifyHousingPayment(paymentSlipFile, userId, roomNumber, identity.ocrData.verificationId!, true);
    return { ...identity, ...payment };
  }

  static async submitApplication(data: SubmitApplicationInput, db?: DbClient): Promise<Tenant> {
    const client = db || prisma;
    const run = async (client: Prisma.TransactionClient): Promise<Tenant> => {
      const { personalInformation, emergencyContact, roomPreference, ocrData, idCardImagePath, paymentSlipPath, userId } = data;

      const validatedContract = validateHousingApplication(data);
      // All tenant writers lock User -> Tenant -> rooms in ascending ID order.
      await this.claimUserVersion(client, userId!);
      const facultyName = await AcademicService.validateSelection(personalInformation.course, personalInformation.facultyId, client);
      if (facultyName) { validatedContract.tenantFaculty = facultyName; validatedContract.tenantCourse = personalInformation.course.trim(); }
      const account = await client.user.findUnique({ where: { id: userId }, select: { phone: true, email: true } });
      if (!account) throw new AppError('User not found', 404);
      if (!account.phone?.trim()) throw new AppError('บัญชียังไม่มีเบอร์โทรศัพท์ กรุณาให้ผู้ดูแลเพิ่มเบอร์โทรในบัญชี แล้วโหลดข้อมูลเดิมก่อนยืนยันใบสมัคร ยอดชำระเดิมยังคงอยู่', 400);
      let existing = await client.tenant.findUnique({ where: { userId } });
      if (existing) {
        await client.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${existing.id} FOR UPDATE`;
        existing = await client.tenant.findUnique({ where: { userId } });
      }
      if (existing?.status === 'INACTIVE') throw new AppError('ให้ผู้ดูแลจัดการข้อมูลการเข้าพักเดิมก่อนยื่นใบสมัครใหม่ เพื่อไม่ให้ทับประวัติย้ายออก', 409);
      const requestedRoomNumber = roomPreference.roomNumber!.trim();
      const selectedRoom = await client.room.findUnique({ where: { roomNumber: requestedRoomNumber } });
      if (!selectedRoom) throw new AppError('Room not found', 404);
      await client.$queryRaw`SELECT 1 AS acquired FROM pg_advisory_xact_lock(756032)`;
      const terms = await getContractTerms(selectedRoom, client);
      if (Object.values(terms).some(value => !value.trim())) throw new AppError('ผู้ดูแลยังตั้งค่าเงื่อนไขสัญญาไม่ครบ กรุณาติดต่อผู้ดูแล ยอดชำระเดิมยังคงอยู่', 409);
      for (const [key, value] of Object.entries(terms)) {
        if (key.startsWith('doc') && key !== 'docLocation') continue;
        if (validatedContract[key] !== value) throw new AppError('เงื่อนไขสัญญาเปลี่ยนแล้ว กรุณาโหลดข้อมูลและตรวจสัญญาอีกครั้ง ยอดชำระเดิมยังคงอยู่', 409);
      }
      Object.assign(validatedContract, terms);
      const roomIds = [...new Set([existing?.roomId, selectedRoom.id].filter((id): id is number => id != null))].sort((a, b) => a - b);
      for (const roomId of roomIds) {
        await client.$queryRaw`SELECT id FROM "Room" WHERE id = ${roomId} FOR UPDATE`;
      }
      const payment = await HousingPaymentService.requireVerifiedPayment(client, {
        paymentId: data.paymentId!, userId: userId!, roomNumber: roomPreference.roomNumber!.trim(),
        verificationId: ocrData!.verificationId!, slipPath: paymentSlipPath!,
        monthlyRent: validatedContract.monthlyRent, depositAmount: validatedContract.depositAmount, keycardDeposit: validatedContract.keycardDeposit,
        excessAccepted: data.excessAccepted === true,
      });
      if (payment.housingDraftId && payment.housingExcessAmount > 0) {
        validatedContract.paymentExcessAccepted = 'true';
        validatedContract.paymentExcessAcceptedAt = new Date().toISOString();
        validatedContract.paymentExcessAmount = (payment.housingExcessAmount / 100).toFixed(2);
      }
      if (payment.housingTenantId) {
        const existing = await client.tenant.findUnique({ where: { id: payment.housingTenantId } });
        if (existing && existing.userId === userId) return existing;
        throw new AppError('รายการชำระนี้ถูกใช้ยื่นใบสมัครแล้ว', 409);
      }
      if (validatedContract.roomNumber !== roomPreference.roomNumber!.trim()) {
        throw new AppError('ห้องในสัญญาไม่ตรงกับห้องที่ชำระเงิน', 400);
      }
      const verification = await client.idCardVerification.findUnique({
        where: { id: ocrData!.verificationId! },
      });
      if (!verification || verification.userId !== userId || !verification.idDetected || !verification.imagePath) {
        throw new AppError('ไม่พบผลตรวจบัตรประชาชนที่ผ่านสำหรับผู้ใช้นี้ กรุณาอัปโหลดใหม่', 422);
      }
      const applicantName = normalizeThaiNameForComparison(personalInformation.fullName);
      const contractName = normalizeThaiNameForComparison(validatedContract.tenantName);
      const verifiedName = normalizeThaiNameForComparison(verification.fullNameTh ?? '');
      if (!applicantName || !verifiedName || applicantName !== verifiedName || contractName !== applicantName) {
        throw new AppError('ชื่อ-นามสกุลไม่ตรงกับข้อมูลบนบัตรประชาชน กรุณาตรวจสอบชื่อหรือสแกนบัตรใหม่', 400);
      }
      if (data.contractAccepted === true) {
        validatedContract.contractAccepted = 'true';
        validatedContract.contractAcceptedAt = new Date().toISOString();
      }
      validatedContract.tenantName = personalInformation.fullName.trim();
      validatedContract.tenantPhone = account.phone.trim();
      if (personalInformation.citizenId !== undefined) validatedContract.tenantCitizenId = personalInformation.citizenId.trim();
      if (personalInformation.address !== undefined) validatedContract.tenantAddress = personalInformation.address.trim();
      if (personalInformation.birthDate !== undefined) {
        validatedContract.tenantAge = String(calculateAge(personalInformation.birthDate));
        validatedContract.tenantBirthDate = personalInformation.birthDate;
      }
      if (verification.idChecksumValid && verification.citizenIdHash && verification.citizenIdHash !== createHash('sha256').update(validatedContract.tenantCitizenId).digest('hex')) {
        throw new AppError('เลขบัตรประชาชนไม่ตรงกับผลตรวจบัตรที่ยืนยันแล้ว', 400);
      }
      const verifiedPath = this.resolveTenantDocumentPath(verification.imagePath);
      const submittedPath = this.resolveTenantDocumentPath(idCardImagePath);
      const slipPath = this.resolveTenantDocumentPath(paymentSlipPath);
      const slipRoot = path.resolve(process.env.UPLOAD_ROOT || path.join(process.cwd(), 'uploads/private'), 'payment-slips');
      if (verifiedPath !== submittedPath || path.dirname(slipPath) !== slipRoot) {
        throw new AppError('เอกสารไม่ตรงกับผลตรวจบัตรประชาชน กรุณาอัปโหลดใหม่', 400);
      }
      try {
        await Promise.all([fs.access(verifiedPath), fs.access(slipPath)]);
      } catch {
        throw new AppError('ไม่พบไฟล์เอกสาร กรุณาอัปโหลดใหม่', 400);
      }

      const tenantPayload: Prisma.TenantCreateInput = {
        fullName: validatedContract.tenantName,
        studentId: personalInformation.studentId?.trim(),
        course: personalInformation.course?.trim(),
        yearLevel: personalInformation.yearLevel,
        phone: validatedContract.tenantPhone,
        email: account.email,
        emergencyName: emergencyContact?.emergencyName?.trim(),
        emergencyRelation: emergencyContact?.relationship,
        emergencyContact: emergencyContact?.emergencyNumber?.trim(),
        preferredRoomType: roomPreference?.preferredRoomType,
        notes: roomPreference?.notes?.trim(),
        citizenId: validatedContract.tenantCitizenId,
        address: validatedContract.tenantAddress,
        birthDate: personalInformation.birthDate || verification.birthDateTh || undefined,
        idCardImagePath,
        paymentSlipPath,
        contractData: JSON.stringify(validatedContract),
        status: 'PENDING',
        isActive: true,
      };

      // Re-read after locking: another applicant may have taken the last place.
      const targetRoom = await client.room.findUnique({
        where: { id: selectedRoom.id },
        include: { tenants: { where: { ...ROOM_RESERVATION_FILTER, ...(existing ? { id: { not: existing.id } } : {}) } } },
      });
      if (!targetRoom || targetRoom.id !== payment.housingRoomId) {
        throw new AppError('ห้องไม่ตรงกับรายการชำระเงิน กรุณาติดต่อเจ้าหน้าที่', 409);
      }
      if (!['AVAILABLE', 'OCCUPIED'].includes(targetRoom.status)) {
        throw new AppError('ห้องไม่พร้อมรับสมัคร กรุณาติดต่อเจ้าหน้าที่', 409);
      }
      const maxOccupants = await this.getMaxOccupants();
      this.assertRoomHasCapacity(targetRoom, maxOccupants);
      await HousingDraftService.assertHeldCapacity(client, targetRoom, targetRoom.tenants.length, maxOccupants, userId!);
      tenantPayload.room = { connect: { id: targetRoom.id } };
      if (existing && ['APPROVED', 'ACTIVE'].includes(existing.status)) {
        throw new AppError('ใบสมัครได้รับการอนุมัติแล้ว ไม่สามารถส่งทับได้', 409);
      }
      const tenant = existing
        ? await client.tenant.update({ where: { id: existing.id }, data: tenantPayload })
        : await client.tenant.create({ data: { ...tenantPayload, user: { connect: { id: userId! } } } });
      const paymentIds = payment.housingDraftId
        ? (await client.payment.findMany({ where: { housingDraftId: payment.housingDraftId, payerUserId: userId, status: 'PAID' }, select: { id: true } })).map(p => p.id)
        : [payment.id];
      const consumed = await client.payment.updateMany({
        where: { id: payment.housingDraftId ? { in: paymentIds } : payment.id, status: 'PAID', housingTenantId: null }, data: { housingTenantId: tenant.id },
      });
      if (consumed.count !== paymentIds.length) throw new AppError('รายการชำระนี้ถูกใช้ยื่นใบสมัครแล้ว', 409);
      if (payment.housingDraftId) await client.housingApplicationDraft.update({ where: { id: payment.housingDraftId }, data: { status: 'SUBMITTED', roomHoldExpiresAt: null, version: { increment: 1 } } });
      for (const roomId of roomIds) await this.refreshRoomStatus(client, roomId, maxOccupants);
      return tenant;
    };
    return '$transaction' in client
      ? client.$transaction(run, { timeout: 15000 })
      : run(client);
  }

  static async createTenant(data: CreateTenantInput, db?: DbClient): Promise<Tenant> {
    const client = db || prisma;
    const run = async (client: Prisma.TransactionClient): Promise<Tenant> => {
      const status = data.status ?? 'PENDING';
      if (!['PENDING', 'APPROVED', 'REJECTED', 'ACTIVE', 'INACTIVE'].includes(status)) {
        throw new AppError('Invalid tenant status', 400);
      }
      if (data.userId != null) {
        await this.claimUserVersion(client, data.userId);
        if (await client.tenant.findUnique({ where: { userId: data.userId } })) {
          throw new AppError('ผู้ใช้นี้มีรายการผู้พักแล้ว', 409);
        }
      }
      const maxOccupants = await this.getMaxOccupants();
      if (data.roomId != null) {
        await client.$queryRaw`SELECT id FROM "Room" WHERE id = ${data.roomId} FOR UPDATE`;
        const room = await client.room.findUnique({
          where: { id: data.roomId }, include: { tenants: { where: ROOM_RESERVATION_FILTER } },
        });
        if (!room) throw new AppError('Room not found', 404);
        if (!['AVAILABLE', 'OCCUPIED'].includes(room.status)) throw new AppError('ห้องไม่พร้อมรับผู้พัก', 409);
        this.assertRoomHasCapacity(room, maxOccupants);
        await HousingDraftService.assertHeldCapacity(client, room, room.tenants.length, maxOccupants, data.userId ?? 0);
      }
      const tenant = await TenantsRepository.createTenant({
        userId: data.userId ?? null, roomId: data.roomId ?? null,
        fullName: data.fullName?.trim(), phone: data.phone?.trim(),
        emergencyContact: data.emergencyContact?.trim(),
        checkInDate: data.checkInDate ? new Date(data.checkInDate) : null,
        checkOutDate: data.checkOutDate ? new Date(data.checkOutDate) : null,
        isActive: data.isActive ?? true, status,
      }, client);
      if (data.roomId != null) await this.refreshRoomStatus(client, data.roomId, maxOccupants);
      return tenant;
    };
    return '$transaction' in client
      ? client.$transaction(run, { timeout: 15000 })
      : run(client);
  }

  static async updateTenant(id: number, data: Partial<CreateTenantInput>, db?: DbClient) {
    const client = db || prisma;
    if (data.status !== undefined && !['PENDING', 'APPROVED', 'REJECTED', 'ACTIVE', 'INACTIVE'].includes(data.status)) {
      throw new AppError('Invalid tenant status', 400);
    }

    const updateWithinTransaction = async (tx: Prisma.TransactionClient) => {
      const snapshot = await tx.tenant.findUnique({ where: { id } });
      if (!snapshot) throw new AppError('Tenant not found', 404);
      const userIds = [...new Set([snapshot.userId, data.userId].filter((userId): userId is number => userId != null))].sort((a, b) => a - b);
      for (const userId of userIds) await this.claimUserVersion(tx, userId);
      // Serialize edits after locking the linked users, matching application/create.
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${id} FOR UPDATE`;
      const tenant = await tx.tenant.findUnique({ where: { id } });
      if (!tenant) throw new AppError('Tenant not found', 404);
      if (tenant.userId !== snapshot.userId) throw new AppError('ข้อมูลผู้พักถูกแก้ไขพร้อมกัน กรุณาลองใหม่', 409);

      if (tenant.status === 'ARCHIVED') throw new AppError('ข้อมูลผู้พักถูกลบแล้ว', 409);
      if (tenant.status === 'REJECTED' && data.status && ['PENDING', 'APPROVED', 'ACTIVE'].includes(data.status)
        && tenant.userId !== null && await tx.housingApplicationDraft.findFirst({ where: { userId: tenant.userId, status: 'OPEN' } })) {
        throw new AppError('ผู้สมัครกำลังแก้ใบสมัคร กรุณารอให้ยื่นใบสมัครใหม่ก่อนพิจารณา', 409);
      }
      if (tenant.status === 'INACTIVE' && (data.status && data.status !== 'INACTIVE' || data.isActive === true || data.roomId != null || data.userId !== undefined)) {
        throw new AppError('ผู้ย้ายออกต้องยื่นใบสมัครใหม่ ไม่สามารถเปิดการเข้าพักเดิม', 409);
      }
      if (data.status === 'REJECTED' && ['ACTIVE', 'APPROVED'].includes(tenant.status)) throw new AppError('ให้ใช้บันทึกย้ายออกสำหรับผู้ที่เข้าพักแล้ว', 409);
      if (data.isActive === false && ['ACTIVE', 'APPROVED'].includes(tenant.status) && data.status !== 'INACTIVE') throw new AppError('ต้องบันทึกสถานะย้ายออกด้วย', 409);
      if (data.status === 'INACTIVE') {
        if (!['ACTIVE', 'APPROVED', 'INACTIVE'].includes(tenant.status)) throw new AppError('สถานะนี้ยังไม่สามารถบันทึกย้ายออกได้', 409);
        if (await tx.bill.count({ where: { tenantId: id, status: { not: 'PAID' } } })) throw new AppError('ต้องจัดการบิลค้างก่อนย้ายออก', 409);
        const checkout = data.checkOutDate ? new Date(data.checkOutDate) : tenant.checkOutDate ?? new Date();
        if (!Number.isFinite(checkout.getTime()) || checkout > new Date() || tenant.checkInDate && checkout < tenant.checkInDate) throw new AppError('วันที่ย้ายออกไม่ถูกต้อง', 400);
        data = { ...data, checkOutDate: checkout, isActive: false };
      }

      const updateData: Prisma.TenantUpdateInput = {
        fullName: data.fullName?.trim(), phone: data.phone?.trim(),
        emergencyContact: data.emergencyContact?.trim(),
        checkInDate: data.checkInDate ? new Date(data.checkInDate) : undefined,
        checkOutDate: data.checkOutDate ? new Date(data.checkOutDate) : undefined,
        isActive: data.isActive, status: data.status,
      };
      if ('userId' in data) {
        if (data.userId === null) updateData.user = { disconnect: true };
        else if (data.userId !== undefined) updateData.user = { connect: { id: data.userId } };
      }

      const maxOccupants = await this.getMaxOccupants();
      const becomingActive = data.status === 'APPROVED' || data.status === 'ACTIVE';
      const releasingRoom = data.isActive === false || ['REJECTED', 'INACTIVE'].includes(data.status ?? '');
      let nextRoomId = releasingRoom ? null : data.roomId !== undefined ? data.roomId : tenant.roomId;
      // Pending applications reserve places; rejected/inactive records do not.
      const reservations = ROOM_RESERVATION_FILTER;
      if (becomingActive && nextRoomId === null && data.roomId === undefined && !releasingRoom) {
        const candidates = await tx.room.findMany({
          where: { status: { in: ['AVAILABLE', 'OCCUPIED'] } },
          include: { tenants: { where: reservations } },
        });
        const available = candidates.filter((candidate) => candidate.tenants.length < Math.min(candidate.capacity, maxOccupants));
        if (available.length === 0) throw new AppError('No available rooms in the system', 409);
        // Keep random assignment; the locked recheck below handles a competing approval.
        nextRoomId = available[Math.floor(Math.random() * available.length)].id;
      }

      const affectedRoomIds = [...new Set([tenant.roomId, nextRoomId].filter((roomId): roomId is number => roomId !== null))].sort((a, b) => a - b);
      // Use a stable order when moving between rooms to avoid opposite moves deadlocking.
      for (const roomId of affectedRoomIds) {
        await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${roomId} FOR UPDATE`;
      }
      if (nextRoomId !== null && (becomingActive || nextRoomId !== tenant.roomId || data.roomId !== undefined || data.isActive === true)) {
        const target = await tx.room.findUnique({
          where: { id: nextRoomId },
          include: { tenants: { where: { ...reservations, id: { not: id } } } },
        });
        if (!target) throw new AppError('Room not found', 404);
        if (!['AVAILABLE', 'OCCUPIED'].includes(target.status)) throw new AppError('ห้องไม่พร้อมรับผู้พัก', 409);
        this.assertRoomHasCapacity(target, maxOccupants);
        await HousingDraftService.assertHeldCapacity(tx, target, target.tenants.length, maxOccupants, tenant.userId ?? 0);
      }

      if (nextRoomId !== tenant.roomId) {
        updateData.room = nextRoomId === null ? { disconnect: true } : { connect: { id: nextRoomId } };
      }
      if (becomingActive && tenant.status === 'PENDING' && tenant.userId !== null) {
        await FaceCleanupService.restoreForApprovedApplication(tx, tenant.userId);
      }
      const updated = await TenantsRepository.updateTenant(id, updateData, tx);
      if (becomingActive) {
        // The ADMIN-only tenant approval transaction confirms the linked deposit once.
        await tx.payment.updateMany({
          where: { housingTenantId: id, billId: null, status: 'PAID', housingApprovedAt: null },
          data: { housingApprovedAt: new Date() },
        });
      }
      for (const roomId of affectedRoomIds) await this.refreshRoomStatus(tx, roomId, maxOccupants);
      return updated;
    };

    const ownsTransaction = '$transaction' in client;
    const updated = ownsTransaction
      ? await client.$transaction(updateWithinTransaction, { timeout: 15000 })
      : await updateWithinTransaction(client);
    // An injected transaction's owner must publish only after it commits.
    if (ownsTransaction) {
      publishAdminAlert(updated.id, 'TENANT_STATUS', `อัปเดตสถานะผู้พักอาศัย ${updated.fullName || ''}: ${updated.status}`, updated.status);
      publishResidentStatus(updated.userId, updated.id, updated.status);
    }
    return updated;
  }

  static async deleteTenant(id: number, db?: DbClient) {
    const cleanup = await AccountRetentionService.deleteTenant(id, db);
    publishAdminAlert(id, 'TENANT_STATUS', `ลบข้อมูลส่วนบุคคลผู้พัก #${id}${cleanup.status === 'PENDING' ? ' รอล้างไฟล์และข้อมูลใบหน้า' : ''}`, cleanup.status === 'PENDING' ? 'CLEANUP_PENDING' : 'DELETED');
    return { cleanup };
  }
}
