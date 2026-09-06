import { prisma } from '../../database/db';
import { AppError } from '../../middlewares/error-handler';
import { TenantsRepository } from './tenants.repository';
import path from 'path';

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
    fullNameTh?: string;
    verificationId?: number;
  };
  idCardImagePath?: string;
  paymentSlipPath?: string;
  contractData?: Record<string, any>;
  userId?: number;
}

export class TenantsService {
  static async listTenants(db?: any) {
    return TenantsRepository.listTenants(undefined, undefined, db);
  }

  static async getTenantById(id: number, db?: any) {
    return TenantsRepository.getTenantById(id, db);
  }

  static async getTenantByUserId(userId: number, db?: any) {
    return TenantsRepository.getTenantByUserId(userId, db);
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

  static async submitApplication(data: SubmitApplicationInput, db?: any) {
    const { personalInformation, emergencyContact, roomPreference, ocrData, idCardImagePath, paymentSlipPath, contractData, userId } = data;

    if (!personalInformation?.fullName?.trim()) {
      throw new AppError('Full Name is required', 400);
    }

    const tenantPayload: any = {
      fullName: personalInformation.fullName.trim(),
      studentId: personalInformation.studentId?.trim(),
      course: personalInformation.course?.trim(),
      yearLevel: personalInformation.yearLevel,
      phone: personalInformation.contactNumber?.trim(),
      email: personalInformation.emailAddress?.trim(),
      emergencyName: emergencyContact?.emergencyName?.trim(),
      emergencyRelation: emergencyContact?.relationship,
      emergencyContact: emergencyContact?.emergencyNumber?.trim(),
      preferredRoomType: roomPreference?.preferredRoomType,
      notes: roomPreference?.notes?.trim(),
      citizenId: ocrData?.citizenId?.trim(),
      address: ocrData?.address?.trim(),
      birthDate: ocrData?.birthDate?.trim(),
      idCardImagePath,
      paymentSlipPath,
      contractData: contractData ? JSON.stringify(contractData) : null,
      status: 'PENDING',
      isActive: true,
    };

    const client = db || prisma;

    // Resolve room assignment (selected room or random room on chosen floor)
    let targetRoomId: number | null = null;
    const requestedRoomNumber = roomPreference?.roomNumber?.trim() || (contractData?.roomNumber ? String(contractData.roomNumber).trim() : '');

    if (requestedRoomNumber) {
      const room = await client.room.findUnique({
        where: { roomNumber: requestedRoomNumber },
      });
      if (room) {
        targetRoomId = room.id;
      }
    } else if (roomPreference?.isRandomRoom) {
      const floorMatch = roomPreference?.preferredRoomType?.match(/Floor\s*(\d+)/i) || roomPreference?.preferredRoomType?.match(/ชั้น\s*(\d+)/i);
      const floorNum = floorMatch ? parseInt(floorMatch[1], 10) : undefined;

      const availableRooms = await client.room.findMany({
        where: {
          ...(floorNum ? { floor: floorNum } : {}),
          status: 'AVAILABLE',
        },
        include: { tenants: true },
      });

      const openRooms = availableRooms.filter((r: any) => (r.tenants?.length ?? 0) < (r.capacity ?? 4));
      if (openRooms.length > 0) {
        const randomIndex = Math.floor(Math.random() * openRooms.length);
        targetRoomId = openRooms[randomIndex].id;
      }
    }

    if (targetRoomId) {
      tenantPayload.room = { connect: { id: targetRoomId } };
    }

    if (userId) {
      const existing = await client.tenant.findUnique({ where: { userId } });
      if (existing) {
        return client.tenant.update({
          where: { userId },
          data: tenantPayload,
        });
      }
      tenantPayload.user = { connect: { id: userId } };
    }

    return client.tenant.create({ data: tenantPayload });
  }

  static async createTenant(data: CreateTenantInput, db?: any) {
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
      } as any, db);
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

  static async updateTenant(id: number, data: Partial<CreateTenantInput>, db?: any) {
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

    const updateData: any = {
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
      const availableRooms = rooms.filter((r: any) => r.tenants.length < (r.capacity ?? 4));

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
      const hasSelf = currentRoom?.tenants?.some((t: any) => t.id === tenant.id);
      const occupantsCount = (currentRoom?.tenants?.length ?? 0) + (hasSelf ? 0 : 1);
      const isNowOccupied = occupantsCount >= (currentRoom?.capacity ?? 4);
      await client.room.update({
        where: { id: tenant.roomId },
        data: { status: isNowOccupied ? 'OCCUPIED' : 'AVAILABLE' },
      });
    }

    return TenantsRepository.updateTenant(id, updateData, client);
  }

  static async deleteTenant(id: number, db?: any) {
    const tenant = await TenantsRepository.getTenantById(id, db);
    if (!tenant) {
      throw new AppError('Tenant not found', 404);
    }

    return TenantsRepository.deleteTenant(id, db);
  }
}
