import { Prisma } from '@prisma/client';
import { prisma } from '../../database/db';

export class MaintenanceRepository {
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
    return db.maintenanceTicket.update({ where: { id }, data });
  }

  static async deleteTicket(id: number, db = prisma) {
    return db.maintenanceTicket.delete({ where: { id } });
  }
}
