import { prisma } from '../../database/db';

export class MaintenanceService {
  static async getTicketById(id: number) {
    return prisma.maintenanceTicket.findUnique({ where: { id } });
  }

  static async createTicket(data: { tenantId: number; roomId?: number; category: string; description: string; contactTime?: Date }) {
    return prisma.maintenanceTicket.create({
      data: {
        tenantId: data.tenantId,
        roomId: data.roomId,
        category: data.category as any,
        description: data.description,
        contactTime: data.contactTime,
      },
    });
  }

  static async listTickets(userId?: number, role?: string) {
    const where = role === 'ADMIN'
      ? {}
      : { tenant: { userId } };

    return prisma.maintenanceTicket.findMany({
      where,
      include: { tenant: true, room: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async updateTicketStatus(id: number, status: string, note?: string) {
    return prisma.maintenanceTicket.update({
      where: { id },
      data: {
        status: status as any,
        note,
      },
    });
  }
}
