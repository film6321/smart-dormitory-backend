import { Prisma } from '@prisma/client';
import { prisma } from '../../database/db';

export class RoomsRepository {
  static async listRooms(db = prisma) {
    return db.room.findMany({
      orderBy: { roomNumber: 'asc' },
    });
  }

  static async getRoomById(id: number, db = prisma) {
    return db.room.findUnique({
      where: { id },
    });
  }

  static async findByNumber(roomNumber: string, db = prisma) {
    return db.room.findUnique({ where: { roomNumber } });
  }

  static async createRoom(data: Prisma.RoomCreateInput, db = prisma) {
    return db.room.create({ data });
  }

  static async updateRoom(id: number, data: Prisma.RoomUpdateInput, db = prisma) {
    return db.room.update({ where: { id }, data });
  }

  static async deleteRoom(id: number, db = prisma) {
    return db.room.delete({ where: { id } });
  }
}
