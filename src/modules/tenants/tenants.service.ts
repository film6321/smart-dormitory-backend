import fs from 'fs/promises';
import { HousingPaymentService } from './housing-payment.service';
import { OcrService } from '../ocr/ocr.service';
import { isFilledText, validateHousingApplication } from './tenants.dto';
import { logger } from '../../logger';
import { prisma, type DbClient } from '../../database/db';
import type { Prisma, Room, Tenant } from '@prisma/client';
import { AppError } from '../../middlewares/error-handler';
import { TenantsRepository } from './tenants.repository';
import path from 'path';
import { getSettingValue } from '../settings/settings.service';
import { calculateAge } from '../../shared/date-utils';
import { publishAdminAlert } from '../../realtime/notification-gateway';

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
    yearLevel: string;
    contactNumber: string;
    emailAddress: string;
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

  private static assertRoomHasCapacity(room: { capacity: number; tenants?: Array<unknown> }, maxOccupants: number) {
    const configuredCapacity = Math.min(room.capacity || maxOccupants, maxOccupants);
    if ((room.tenants?.length ?? 0) >= configuredCapacity) {
      throw new AppError(`ห้องพักเต็มตามข้อกำหนด ${maxOccupants} คน`, 409);
    }
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
    return {
      ...tenant,
      age: calculateAge(tenant.birthDate),
    };
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

  static async uploadDocuments(idCardFile: UploadedFile, paymentSlipFile: UploadedFile, userId: number, roomNumber: string) {
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
    let payment: Awaited<ReturnType<typeof HousingPaymentService.verifySlip>>;
    try {
      payment = await HousingPaymentService.verifySlip(roomNumber, userId, paymentSlipFile, result.verificationId);
    } catch (error) {
      if (error instanceof AppError) throw new AppError(`ตรวจบัตรประชาชนแล้ว แต่ยังไม่ผ่านการตรวจสลิป: ${error.message}`, error.statusCode);
      throw error;
    }
    const readable = (value: unknown) => (isFilledText(value) && !value.includes('*') ? value.trim() : '');
    return {
      idCardImagePath: result.imagePath,
      paymentSlipPath: payment.slipPath!,
      paymentVerification: { id: payment.id, status: 'PAID' as const, amount: Number(payment.amount) },
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

  static async submitApplication(data: SubmitApplicationInput, db?: DbClient): Promise<Tenant> {
    if (!db) return prisma.$transaction((tx) => this.submitApplication(data, tx), { timeout: 15000 });
    const { personalInformation, emergencyContact, roomPreference, ocrData, idCardImagePath, paymentSlipPath, contractData, userId } = data;

    const validatedContract = validateHousingApplication(data);
    const client = db || prisma;
    const payment = await HousingPaymentService.requireVerifiedPayment(client, {
      paymentId: data.paymentId!, userId: userId!, roomNumber: roomPreference.roomNumber!.trim(),
      verificationId: ocrData!.verificationId!, slipPath: paymentSlipPath!,
      monthlyRent: validatedContract.monthlyRent, depositAmount: validatedContract.depositAmount,
    });
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
      email: personalInformation.emailAddress?.trim(),
      emergencyName: emergencyContact?.emergencyName?.trim(),
      emergencyRelation: emergencyContact?.relationship,
      emergencyContact: emergencyContact?.emergencyNumber?.trim(),
      preferredRoomType: roomPreference?.preferredRoomType,
      notes: roomPreference?.notes?.trim(),
      citizenId: validatedContract.tenantCitizenId,
      address: validatedContract.tenantAddress,
      birthDate: verification.birthDateTh || undefined,
      idCardImagePath,
      paymentSlipPath,
      contractData: JSON.stringify(validatedContract),
      status: 'PENDING',
      isActive: true,
    };

    // The verified payment identifies the concrete room, including a room picked randomly in the UI.
    let targetRoomId: number | null = null;
    const requestedRoomNumber = roomPreference?.roomNumber?.trim() || (contractData?.roomNumber ? String(contractData.roomNumber).trim() : '');

    if (requestedRoomNumber) {
      const room = await client.room.findUnique({
        where: { roomNumber: requestedRoomNumber },
      });
      if (room) {
        if (room.status !== 'AVAILABLE') throw new AppError('ห้องไม่พร้อมรับสมัคร กรุณาติดต่อเจ้าหน้าที่', 409);
        const maxOccupants = await this.getMaxOccupants();
        const roomWithTenants = await client.room.findUnique({ where: { id: room.id }, include: { tenants: { where: { isActive: true } } } });
        this.assertRoomHasCapacity({ capacity: room.capacity, tenants: roomWithTenants?.tenants }, maxOccupants);
        targetRoomId = room.id;
      }
    }

    if (targetRoomId) {
      tenantPayload.room = { connect: { id: targetRoomId } };
    }

    if (!targetRoomId || targetRoomId !== payment.housingRoomId) {
      throw new AppError('ห้องไม่ตรงกับรายการชำระเงิน กรุณาติดต่อเจ้าหน้าที่', 409);
    }
    // OCC serializes submissions by this applicant without trusting browser state.
    const applicant = await client.user.findUnique({ where: { id: userId! }, select: { version: true } });
    if (!applicant) throw new AppError('ไม่พบผู้สมัคร', 404);
    const claimedUser = await client.user.updateMany({
      where: { id: userId!, version: applicant.version }, data: { version: { increment: 1 } },
    });
    if (claimedUser.count !== 1) throw new AppError('มีคำขอยื่นใบสมัครพร้อมกัน กรุณาลองใหม่', 409);
    const existing = await client.tenant.findUnique({ where: { userId } });
    if (existing && ['APPROVED', 'ACTIVE'].includes(existing.status)) {
      throw new AppError('ใบสมัครได้รับการอนุมัติแล้ว ไม่สามารถส่งทับได้', 409);
    }
    const tenant = existing
      ? await client.tenant.update({ where: { id: existing.id }, data: tenantPayload })
      : await client.tenant.create({ data: { ...tenantPayload, user: { connect: { id: userId! } } } });
    const consumed = await client.payment.updateMany({
      where: { id: payment.id, status: 'PAID', housingTenantId: null }, data: { housingTenantId: tenant.id },
    });
    if (consumed.count !== 1) throw new AppError('รายการชำระนี้ถูกใช้ยื่นใบสมัครแล้ว', 409);
    return tenant;
  }

  static async createTenant(data: CreateTenantInput, db?: DbClient) {
    if (data.userId !== undefined && data.userId !== null) {
      const user = await TenantsRepository.findUserById(data.userId, db);
      if (!user) {
        throw new AppError('User not found', 404);
      }
    }

    if (data.roomId !== undefined && data.roomId !== null) {
      const room = await TenantsRepository.findRoomById(data.roomId, db);
      if (!room) {
        throw new AppError('Room not found', 404);
      }
      const client = db || prisma;
      const roomWithTenants = await client.room.findUnique({ where: { id: data.roomId }, include: { tenants: { where: { isActive: true } } } });
      this.assertRoomHasCapacity({ capacity: room.capacity, tenants: roomWithTenants?.tenants }, await this.getMaxOccupants());
    }

    // If a fake/mock db is injected (unit tests), prefer flat userId/roomId fields
    if (db) {
      return TenantsRepository.createTenant({
        userId: data.userId ?? null,
        roomId: data.roomId ?? null,
        fullName: data.fullName?.trim(),
        phone: data.phone?.trim(),
        emergencyContact: data.emergencyContact?.trim(),
        checkInDate: data.checkInDate ? new Date(data.checkInDate) : null,
        checkOutDate: data.checkOutDate ? new Date(data.checkOutDate) : null,
        isActive: data.isActive ?? true,
      } as Prisma.TenantUncheckedCreateInput, db);
    }

    return TenantsRepository.createTenant({
      user: data.userId !== undefined && data.userId !== null ? { connect: { id: data.userId } } : undefined,
      room: data.roomId !== undefined && data.roomId !== null ? { connect: { id: data.roomId } } : undefined,
      fullName: data.fullName?.trim(),
      phone: data.phone?.trim(),
      emergencyContact: data.emergencyContact?.trim(),
      checkInDate: data.checkInDate ? new Date(data.checkInDate) : null,
      checkOutDate: data.checkOutDate ? new Date(data.checkOutDate) : null,
      isActive: data.isActive ?? true,
    }, db);
  }

  static async updateTenant(id: number, data: Partial<CreateTenantInput>, db?: DbClient) {
    const client = db || prisma;

    if (data.status !== undefined && !['PENDING', 'APPROVED', 'REJECTED', 'ACTIVE', 'INACTIVE'].includes(data.status)) {
      throw new AppError('Invalid tenant status', 400);
    }

    const tenant = await client.tenant.findUnique({
      where: { id },
      include: { room: true },
    });
    if (!tenant) {
      throw new AppError('Tenant not found', 404);
    }

    const updateData: Prisma.TenantUpdateInput = {
      fullName: data.fullName?.trim(),
      phone: data.phone?.trim(),
      emergencyContact: data.emergencyContact?.trim(),
      checkInDate: data.checkInDate ? new Date(data.checkInDate) : undefined,
      checkOutDate: data.checkOutDate ? new Date(data.checkOutDate) : undefined,
      isActive: data.isActive,
      status: data.status,
    };

    if ('userId' in data) {
      if (data.userId === null) updateData.user = { disconnect: true };
      else if (data.userId !== undefined) updateData.user = { connect: { id: data.userId } };
    }

    // Determine room updates and status changes
    let nextRoomId: number | null | undefined = undefined;
    if ('roomId' in data) {
      nextRoomId = data.roomId;
    }

    const isBecomingActive = data.status === 'APPROVED' || data.status === 'ACTIVE';
    const isBecomingInactive = data.status === 'PENDING' || data.status === 'REJECTED' || data.status === 'INACTIVE';

    if (isBecomingActive && !tenant.roomId && nextRoomId === undefined) {
      // Auto-assign random available room
      const rooms = await client.room.findMany({
        include: { tenants: true },
      });
      const maxOccupants = await this.getMaxOccupants();
      const availableRooms = rooms.filter((r: Room & { tenants: Tenant[] }) => r.tenants.length < Math.min(r.capacity ?? maxOccupants, maxOccupants));

      if (availableRooms.length > 0) {
        const randomIndex = Math.floor(Math.random() * availableRooms.length);
        const selectedRoom = availableRooms[randomIndex];
        updateData.room = { connect: { id: selectedRoom.id } };

        const newOccupantsCount = selectedRoom.tenants.length + 1;
        const isNowOccupied = newOccupantsCount >= (selectedRoom.capacity ?? 4);
        await client.room.update({
          where: { id: selectedRoom.id },
          data: { status: isNowOccupied ? 'OCCUPIED' : 'AVAILABLE' },
        });
      } else {
        throw new AppError('No available rooms in the system', 400);
      }
    } else if (isBecomingInactive && tenant.roomId) {
      // Release current room and disconnect it
      updateData.room = { disconnect: true };
      const currentRoom = await client.room.findUnique({
        where: { id: tenant.roomId },
        include: { tenants: true },
      });
      // The current tenant is still in the room during this query, count minus 1
      const occupantsCount = Math.max(0, (currentRoom?.tenants?.length ?? 0) - 1);
      const isNowOccupied = occupantsCount >= (currentRoom?.capacity ?? 4);
      await client.room.update({
        where: { id: tenant.roomId },
        data: { status: isNowOccupied ? 'OCCUPIED' : 'AVAILABLE' },
      });
    } else if (nextRoomId !== undefined) {
      // Explicit roomId changes
      if (nextRoomId === null) {
        if (tenant.roomId) {
          updateData.room = { disconnect: true };
          const currentRoom = await client.room.findUnique({
            where: { id: tenant.roomId },
            include: { tenants: true },
          });
          const occupantsCount = Math.max(0, (currentRoom?.tenants?.length ?? 0) - 1);
          await client.room.update({
            where: { id: tenant.roomId },
            data: { status: occupantsCount >= (currentRoom?.capacity ?? 4) ? 'OCCUPIED' : 'AVAILABLE' },
          });
        }
      } else {
        if (tenant.roomId && tenant.roomId !== nextRoomId) {
          const prevRoom = await client.room.findUnique({
            where: { id: tenant.roomId },
            include: { tenants: true },
          });
          const occupantsCount = Math.max(0, (prevRoom?.tenants?.length ?? 0) - 1);
          await client.room.update({
            where: { id: tenant.roomId },
            data: { status: occupantsCount >= (prevRoom?.capacity ?? 4) ? 'OCCUPIED' : 'AVAILABLE' },
          });
        }
        updateData.room = { connect: { id: nextRoomId } };

        const targetRoom = await client.room.findUnique({
          where: { id: nextRoomId },
          include: { tenants: true },
        });
        if (!targetRoom) throw new AppError('Room not found', 404);
        const maxOccupants = await this.getMaxOccupants();
        this.assertRoomHasCapacity(targetRoom, maxOccupants);
        const targetOccupantsCount = (targetRoom?.tenants?.length ?? 0) + 1;
        const isNowOccupied = targetOccupantsCount >= (targetRoom?.capacity ?? 4);
        await client.room.update({
          where: { id: nextRoomId },
          data: { status: isNowOccupied ? 'OCCUPIED' : 'AVAILABLE' },
        });
      }
    } else if (isBecomingActive && tenant.roomId) {
      const currentRoom = await client.room.findUnique({
        where: { id: tenant.roomId },
        include: { tenants: true },
      });
      // The current tenant might not be linked in the relations yet (if status was pending)
      const hasSelf = currentRoom?.tenants?.some((t: Tenant) => t.id === tenant.id);
      const occupantsCount = (currentRoom?.tenants?.length ?? 0) + (hasSelf ? 0 : 1);
      const isNowOccupied = occupantsCount >= (currentRoom?.capacity ?? 4);
      await client.room.update({
        where: { id: tenant.roomId },
        data: { status: isNowOccupied ? 'OCCUPIED' : 'AVAILABLE' },
      });
    }

    const updated = await TenantsRepository.updateTenant(id, updateData, client);
    if (updated) {
      publishAdminAlert(updated.id, 'TENANT_STATUS', `อัปเดตสถานะผู้พักอาศัย ${updated.fullName || ''}: ${updated.status || 'ACTIVE'}`, updated.status || 'ACTIVE');
    }
    return updated;
  }

  static async deleteTenant(id: number, db?: DbClient) {
    const tenant = await TenantsRepository.getTenantById(id, db);
    if (!tenant) {
      throw new AppError('Tenant not found', 404);
    }

    const result = await TenantsRepository.deleteTenant(id, db);
    publishAdminAlert(id, 'TENANT_STATUS', `ลบข้อมูลผู้พักอาศัย #${id}`, 'DELETED');
    return result;
  }
}
