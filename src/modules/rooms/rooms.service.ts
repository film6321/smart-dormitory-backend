import { AppError } from '../../middlewares/error-handler';
import { RoomsRepository } from './rooms.repository';
import { type DbClient } from '../../database/db';
import { getSettingValue } from '../settings/settings.service';

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
    if ((data.capacity ?? 1) > maxOccupants) {
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
      capacity: data.capacity ?? 1,
      monthlyRent: Number(data.monthlyRent),
      description: data.description?.trim() ?? null,
    }, db);
  }

  static async updateRoom(id: number, data: Partial<CreateRoomInput>) {
    const payload: Record<string, unknown> = {};

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

    return RoomsRepository.updateRoom(id, payload);
  }

  static async deleteRoom(id: number) {
    return RoomsRepository.deleteRoom(id);
  }
}
