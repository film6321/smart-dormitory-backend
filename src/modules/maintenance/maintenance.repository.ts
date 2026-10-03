import { Prisma } from '@prisma/client';
import { prisma } from '../../database/db';
import { AppError } from '../../middlewares/error-handler';

export class MaintenanceRepository {
  static async createTicketWithinDailyLimit(data: Prisma.MaintenanceTicketCreateInput, tenantId: number, now = new Date(), db = prisma) {
    return db.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { userId: true } });
      if (!tenant?.userId) throw new AppError('Tenant account not found', 404);
      // Lock the account until commit so concurrent requests share the same quota.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${tenant.userId} FOR UPDATE`;
      const thaiOffsetMs = 7 * 60 * 60 * 1000;
      const shifted = new Date(now.getTime() + thaiOffsetMs);
      const start = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - thaiOffsetMs);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      const createdAt = { gte: start, lt: end };
      const submissions = await tx.accessLog.findMany({
        where: { userId: tenant.userId, method: 'MAINTENANCE_CREATED', path: { startsWith: '/api/maintenance/' }, createdAt },
        select: { path: true },
      });
      const recordedIds = submissions.map((entry) => Number(entry.path.slice('/api/maintenance/'.length)))
        .filter((id) => Number.isInteger(id) && id > 0);
      const existing = await tx.maintenanceTicket.count({
        where: { tenant: { userId: tenant.userId }, createdAt, id: { notIn: recordedIds } },
      });
      if (submissions.length + existing >= 3) {
        throw new AppError('ส่งแจ้งซ่อมได้สูงสุด 3 รายการต่อวัน กรุณาลองใหม่หลังเที่ยงคืนตามเวลาไทย', 429);
      }
      const ticket = await tx.maintenanceTicket.create({ data });
      // Persist only successful submissions; deleting a ticket does not reset quota.
      await tx.accessLog.create({ data: { userId: tenant.userId, method: 'MAINTENANCE_CREATED', path: `/api/maintenance/${ticket.id}` } });
      return ticket;
    });
  }

  static async getTicketById(id: number, db = prisma) {
    return db.maintenanceTicket.findUnique({ where: { id } });
  }

  static async createTicket(data: Prisma.MaintenanceTicketCreateInput, db = prisma) {
    return db.maintenanceTicket.create({ data });
  }

  static async listTickets(userId?: number, role?: string, db = prisma) {
    const where = role === 'ADMIN'
      ? {}
      : { tenant: { userId } };

    return db.maintenanceTicket.findMany({
      where,
      include: { tenant: true, room: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async updateTicketStatus(id: number, data: Prisma.MaintenanceTicketUpdateInput, db = prisma) {
    return db.maintenanceTicket.update({
      where: { id, status: { notIn: ['CLOSED', 'CANCELLED'] } }, data,
    });
  }

  static async deleteTicket(id: number, db = prisma) {
    return db.maintenanceTicket.delete({
      where: { id, status: { notIn: ['CLOSED', 'CANCELLED'] } },
    });
  }
}
