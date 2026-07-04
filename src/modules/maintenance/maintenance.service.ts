import { prisma } from '../../database/db';
import NotificationService from '../notifications/notification.service';

export class MaintenanceService {
  static async getTicketById(id: number) {
    return prisma.maintenanceTicket.findUnique({ where: { id } });
  }

  static async createTicket(data: { tenantId: number; roomId?: number; category: string; description: string; contactTime?: Date }) {
    const ticket = await prisma.maintenanceTicket.create({
      data: {
        tenantId: data.tenantId,
        roomId: data.roomId,
        category: data.category as any,
        description: data.description,
        contactTime: data.contactTime,
      },
    });

    const notificationService = new NotificationService();
    await notificationService.scheduleNotification({
      tenantId: ticket.tenantId,
      channel: 'SMS',
      type: 'MAINTENANCE_COMPLETED',
      payload: JSON.stringify({ message: `Maintenance ticket ${ticket.id} created`, category: ticket.category }),
    });

    return ticket;
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
