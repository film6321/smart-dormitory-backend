import NotificationService from '../notifications/notification.service';
import { MaintenanceRepository } from './maintenance.repository';
import { Prisma, MaintenanceCategory, MaintenanceStatus } from '@prisma/client';
import { prisma } from '../../database/db';

export class MaintenanceService {
  static async getTenantByUserId(userId: number) {
    return prisma.tenant.findFirst({ where: { userId } });
  }

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

    // Fire-and-forget: notification failure must not block ticket creation
    try {
      const notificationService = new NotificationService();
      await notificationService.scheduleNotification({
        tenantId: ticket.tenantId,
        channel: 'SMS',
        type: 'MAINTENANCE_COMPLETED',
        payload: JSON.stringify({ message: `Maintenance ticket ${ticket.id} created`, category: ticket.category }),
      });
    } catch (notifErr) {
      // Log but don't propagate - ticket is already saved
      console.warn('[MaintenanceService] Notification scheduling failed (non-critical):', notifErr);
    }

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
