import { Prisma } from '@prisma/client';
import { prisma } from '../../database/db';

export class TenantsRepository {
  static async listTenants(userId?: number, role?: string, db = prisma) {
    const where: Prisma.TenantWhereInput = role === 'ADMIN' ? {} : { userId };

    return db.tenant.findMany({
      where,
      include: { user: true, room: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async getTenantById(id: number, db = prisma) {
    return db.tenant.findUnique({
      where: { id },
      include: { user: true, room: true },
    });
  }

  static async findUserById(id: number, db = prisma) {
    return db.user.findUnique({ where: { id } });
  }

  static async findRoomById(id: number, db = prisma) {
    return db.room.findUnique({ where: { id } });
  }

  static async createTenant(data: Prisma.TenantCreateInput, db = prisma) {
    return db.tenant.create({ data });
  }

  static async updateTenant(id: number, data: Prisma.TenantUpdateInput, db = prisma) {
    return db.tenant.update({ where: { id }, data });
  }

  static async deleteTenant(id: number, db = prisma) {
    return db.tenant.delete({ where: { id } });
  }
}
