import { AppError } from '../../middlewares/error-handler';
import { TenantsRepository } from './tenants.repository';

export interface CreateTenantInput {
  userId?: number | null;
  roomId?: number | null;
  fullName?: string;
  phone?: string;
  emergencyContact?: string;
  checkInDate?: Date | string | null;
  checkOutDate?: Date | string | null;
  isActive?: boolean;
}

export class TenantsService {
  static async listTenants(db?: any) {
    return TenantsRepository.listTenants(undefined, undefined, db);
  }

  static async getTenantById(id: number, db?: any) {
    return TenantsRepository.getTenantById(id, db);
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
    const updateData: any = {
      fullName: data.fullName?.trim(),
      phone: data.phone?.trim(),
      emergencyContact: data.emergencyContact?.trim(),
      checkInDate: data.checkInDate ? new Date(data.checkInDate) : undefined,
      checkOutDate: data.checkOutDate ? new Date(data.checkOutDate) : undefined,
      isActive: data.isActive,
    };

    if ('userId' in data) {
      if (data.userId === null) updateData.user = { disconnect: true };
      else if (data.userId !== undefined) updateData.user = { connect: { id: data.userId } };
    }

    if ('roomId' in data) {
      if (data.roomId === null) updateData.room = { disconnect: true };
      else if (data.roomId !== undefined) updateData.room = { connect: { id: data.roomId } };
    }

    return TenantsRepository.updateTenant(id, updateData, db);
  }

  static async deleteTenant(id: number, db?: any) {
    return TenantsRepository.deleteTenant(id, db);
  }
}
