import { AppError } from '../../middlewares/error-handler';
import { RoomsRepository } from './rooms.repository';
import { prisma, type DbClient } from '../../database/db';
import { getSettingValue } from '../settings/settings.service';
import { HousingDraftService } from '../tenants/housing-draft.service';
import { ROOM_RESERVATION_FILTER } from '../tenants/tenants.repository';

export interface CreateRoomInput {
  roomNumber: string;
  floor?: number | null;
  status?: string;
  capacity?: number;
  monthlyRent: number | string;
  description?: string | null;
}

export class RoomsService {
  static async listRooms() {
    return RoomsRepository.listRooms();
  }

  static async getRoomById(id: number) {
    return RoomsRepository.getRoomById(id);
  }

  static async createRoom(data: CreateRoomInput, db?: DbClient) {
    const maxOccupants = Number(await getSettingValue('maxOccupants')) || 4;
    const capacity = data.capacity ?? 4;
    if (capacity > maxOccupants) {
      throw new AppError(`Room capacity cannot exceed ${maxOccupants}`, 400);
    }
    const roomNumber = data.roomNumber.trim().toUpperCase();
    const existing = await RoomsRepository.findByNumber(roomNumber, db);
    if (existing) {
      throw new AppError('Room number already exists', 409);
    }

    return RoomsRepository.createRoom({
      roomNumber,
      floor: data.floor ?? null,
      status: data.status ?? 'AVAILABLE',
      capacity,
      monthlyRent: Number(data.monthlyRent),
      description: data.description?.trim() ?? null,
    }, db);
  }

  static async updateRoom(id: number, data: Partial<CreateRoomInput>) {
    const payload: Record<string, unknown> = {};

    if (data.monthlyRent !== undefined) {
      const rent = Number(data.monthlyRent);
      if (!['number', 'string'].includes(typeof data.monthlyRent) || String(data.monthlyRent).trim() === ''
        || !Number.isFinite(rent) || rent <= 0 || rent > 99999999.99
        || Math.abs(rent * 100 - Math.round(rent * 100)) > 0.000001) {
        throw new AppError('ค่าเช่าต้องมากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง', 400);
      }
    }

    if (data.capacity !== undefined) {
      const maxOccupants = Number(await getSettingValue('maxOccupants')) || 4;
      if (data.capacity > maxOccupants) {
        throw new AppError(`Room capacity cannot exceed ${maxOccupants}`, 400);
      }
    }

    if (data.roomNumber) {
      payload.roomNumber = data.roomNumber.trim().toUpperCase();
    }
    if (data.floor !== undefined) payload.floor = data.floor ?? null;
    if (data.status) payload.status = data.status;
    if (data.capacity !== undefined) payload.capacity = data.capacity;
    if (data.monthlyRent !== undefined) payload.monthlyRent = Number(data.monthlyRent);
    if (data.description !== undefined) payload.description = data.description?.trim() ?? null;

    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${id} FOR UPDATE`;
      const room = await tx.room.findUnique({ where: { id } });
      if (!room) throw new AppError('ไม่พบห้องที่ต้องการแก้ไข', 404);
      if (data.capacity !== undefined || data.status !== undefined || data.roomNumber !== undefined) {
        const holds = await HousingDraftService.heldPlaces(tx, id);
        const occupants = await tx.tenant.count({ where: { ...ROOM_RESERVATION_FILTER, roomId: id } });
        if (data.capacity !== undefined && data.capacity < occupants + holds
          || holds > 0 && (data.status !== undefined && !['AVAILABLE', 'OCCUPIED'].includes(data.status)
            || data.roomNumber !== undefined && data.roomNumber.trim().toUpperCase() !== room.roomNumber)) {
          throw new AppError('ห้องนี้มีผู้พักหรือสิทธิ์กันที่พักอยู่ ยังลดจำนวน ปิด หรือเปลี่ยนเลขห้องไม่ได้', 409);
        }
      }
      if (data.monthlyRent !== undefined && Number(room.monthlyRent) !== Number(data.monthlyRent)) {
        const [tenants, drafts, payments] = await Promise.all([
          tx.tenant.count({ where: { roomId: id, status: { not: 'ARCHIVED' } } }),
          tx.housingApplicationDraft.count({ where: { roomId: id, status: 'OPEN' } }),
          tx.payment.count({ where: { housingRoomId: id, OR: [
            { status: { in: ['PENDING', 'VERIFYING', 'MANUAL_REVIEW', 'PAID'] } },
            { status: 'FAILED', failureReason: 'PROVIDER_PENDING' },
          ] } }),
        ]);
        if (tenants || drafts || payments) throw new AppError('ยังเปลี่ยนราคาไม่ได้ ห้องนี้มีผู้พัก ใบสมัคร หรือรายการชำระเงินที่เกี่ยวข้อง', 409);
      }
      return RoomsRepository.updateRoom(id, payload, tx);
    });
  }

  static async deleteRoom(id: number) {
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${id} FOR UPDATE`;
      if (await HousingDraftService.heldPlaces(tx, id)) throw new AppError('ห้องนี้มีสิทธิ์กันที่พักอยู่ ยังลบไม่ได้', 409);
      return RoomsRepository.deleteRoom(id, tx);
    });
  }
}
