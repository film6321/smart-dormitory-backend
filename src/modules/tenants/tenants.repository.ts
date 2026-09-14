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
      const visitors = await transaction.visitor.findMany({
        where: { tenantId: id },
        select: { id: true },
      });
      const visitorIds = visitors.map((visitor: { id: number }) => visitor.id);

      if (visitorIds.length > 0) {
        await transaction.visitorLog.deleteMany({ where: { visitorId: { in: visitorIds } } });
        await transaction.visitor.deleteMany({ where: { id: { in: visitorIds } } });
      }

      await transaction.bill.deleteMany({ where: { tenantId: id } });
      await transaction.maintenanceTicket.deleteMany({ where: { tenantId: id } });

      // Retrieve tenant's roomId and release the room status to AVAILABLE
      const tenant = await transaction.tenant.findUnique({
        where: { id },
        select: { roomId: true },
      });
      if (tenant?.roomId) {
        await transaction.room.update({
          where: { id: tenant.roomId },
          data: { status: 'AVAILABLE' },
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
