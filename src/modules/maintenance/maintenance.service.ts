import NotificationService from '../notifications/notification.service';
import { MaintenanceRepository } from './maintenance.repository';
import { Prisma, MaintenanceCategory, MaintenanceStatus } from '@prisma/client';

export class MaintenanceService {
  static async getTicketById(id: number) {
    return MaintenanceRepository.getTicketById(id);
  }

  static async createTicket(data: { tenantId: number; roomId?: number; category: string; description: string; contactTime?: Date }) {
    const ticket = await MaintenanceRepository.createTicket({
      tenant: { connect: { id: data.tenantId } },
      room: data.roomId ? { connect: { id: data.roomId } } : undefined,
      category: data.category as unknown as MaintenanceCategory,
      description: data.description,
      contactTime: data.contactTime,
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
    return MaintenanceRepository.listTickets(userId, role);
  }

  static async updateTicketStatus(id: number, status: string, note?: string) {
    return MaintenanceRepository.updateTicketStatus(id, {
      status: status as unknown as MaintenanceStatus,
      note,
    });
  }
}
