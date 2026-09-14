import { Prisma } from '@prisma/client';
import { prisma, type DbClient } from '../../database/db';

export class RoomsRepository {
  private static readonly tenantSelect = {
    id: true,
    userId: true,
    fullName: true,
    phone: true,
    email: true,
    studentId: true,
    status: true,
    checkInDate: true,
    isActive: true,
    user: {
      select: {
        id: true,
        username: true,
        email: true,
      },
    },
  };

  static async listRooms(db: DbClient = prisma) {
    return db.room.findMany({
      include: {
        tenants: {
          select: RoomsRepository.tenantSelect,
        },
      },
      orderBy: { roomNumber: 'asc' },
    });
  }

  static async getRoomById(id: number, db: DbClient = prisma) {
    return db.room.findUnique({
      where: { id },
      include: {
        tenants: {
          select: RoomsRepository.tenantSelect,
        },
      },
    });
  }

  static async findByNumber(roomNumber: string, db: DbClient = prisma) {
    return db.room.findUnique({
      where: { roomNumber },
      include: {
        tenants: {
          select: RoomsRepository.tenantSelect,
        },
      },
    });
  }

  static async createRoom(data: Prisma.RoomCreateInput, db: DbClient = prisma) {
    return db.room.create({ data });
  }

  static async updateRoom(id: number, data: Prisma.RoomUpdateInput, db: DbClient = prisma) {
    return db.room.update({ where: { id }, data });
  }

  static async deleteRoom(id: number, db: DbClient = prisma) {
    return db.room.delete({ where: { id } });
  }
}
