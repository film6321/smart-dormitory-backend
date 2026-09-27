import { AppError } from '../../middlewares/error-handler';
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
    const remove = async (transaction: Prisma.TransactionClient) => {
      await transaction.$queryRaw`SELECT id FROM "Room" WHERE id = ${id} FOR UPDATE`;
      const record = await transaction.room.findUnique({ where: { id }, include: { _count: true } });
      if (!record) throw new AppError('ไม่พบห้องที่ต้องการลบ', 404);
      if (Object.values(record._count).some((count) => count > 0)) {
        throw new AppError('ลบห้องไม่ได้ เนื่องจากมีข้อมูลหรือประวัติที่เกี่ยวข้องอยู่', 409);
      }
      return transaction.room.delete({ where: { id } });
    };
    return typeof db.$transaction === 'function'
      ? (db as typeof prisma).$transaction(remove) : remove(db);
  }
}
