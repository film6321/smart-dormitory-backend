import { AppError } from '../../middlewares/error-handler';
import { Prisma } from '@prisma/client';
import { prisma, type DbClient } from '../../database/db';

export class TenantsRepository {
  private static readonly userSelect: Prisma.UserSelect = {
    id: true,
    email: true,
    role: true,
    createdAt: true,
    updatedAt: true,
  };

  static async listTenants(userId?: number, role?: string, db: DbClient = prisma) {
    const where: Prisma.TenantWhereInput = role === 'ADMIN' ? {} : { userId };

    return db.tenant.findMany({
      where,
      include: { user: { select: TenantsRepository.userSelect }, room: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async getTenantById(id: number, db: DbClient = prisma) {
    return db.tenant.findUnique({
      where: { id },
      include: { user: { select: TenantsRepository.userSelect }, room: true },
    });
  }

  static async getTenantByUserId(userId: number, db: DbClient = prisma) {
    return db.tenant.findUnique({
      where: { userId },
      include: { user: { select: TenantsRepository.userSelect }, room: true },
    });
  }

  static async findUserById(id: number, db: DbClient = prisma) {
    return db.user.findUnique({
      where: { id },
      select: { id: true },
    });
  }

  static async findRoomById(id: number, db: DbClient = prisma) {
    return db.room.findUnique({ where: { id } });
  }

  static async createTenant(data: Prisma.TenantCreateInput | Prisma.TenantUncheckedCreateInput, db: DbClient = prisma) {
    return db.tenant.create({ data });
  }

  static async updateTenant(id: number, data: Prisma.TenantUpdateInput | Prisma.TenantUncheckedUpdateInput, db: DbClient = prisma) {
    return db.tenant.update({ where: { id }, data });
  }

  static async deleteTenant(id: number, db: DbClient = prisma) {
    const deleteRelatedRecords = async (transaction: Prisma.TransactionClient | typeof prisma) => {
      await transaction.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${id} FOR UPDATE`;
      const tenant = await transaction.tenant.findUnique({ where: { id }, include: { _count: true } });
      if (!tenant) throw new AppError('ไม่พบผู้พักที่ต้องการลบ', 404);
      if (Object.values(tenant._count).some((count) => count > 0)) {
        throw new AppError('ลบผู้พักไม่ได้ เนื่องจากมีประวัติชำระเงิน บิล ผู้มาติดต่อ หรือแจ้งซ่อมที่ต้องเก็บรักษา', 409);
      }
      if (tenant.roomId) {
        await transaction.$queryRaw`SELECT id FROM "Room" WHERE id = ${tenant.roomId} FOR UPDATE`;
        const remaining = await transaction.tenant.count({ where: { roomId: tenant.roomId, id: { not: id } } });
        if (remaining === 0) await transaction.room.updateMany({
          where: { id: tenant.roomId, status: 'OCCUPIED' }, data: { status: 'AVAILABLE' },
        });
      }

      return transaction.tenant.delete({ where: { id } });
    };

    if (typeof db.$transaction === 'function') {
      return (db as typeof prisma).$transaction((transaction: Prisma.TransactionClient) => deleteRelatedRecords(transaction));
    }

    return deleteRelatedRecords(db);
  }
}
