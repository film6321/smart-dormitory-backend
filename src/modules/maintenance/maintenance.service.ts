import NotificationService from '../notifications/notification.service';
import { MaintenanceRepository } from './maintenance.repository';
import { Prisma, MaintenanceCategory, MaintenanceStatus } from '@prisma/client';
import { prisma } from '../../database/db';
import { AppError } from '../../middlewares/error-handler';
import { publishAdminAlert } from '../../realtime/notification-gateway';

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
    const updated = await MaintenanceRepository.updateTicketStatus(id, {
      status: status as unknown as MaintenanceStatus,
      note,
    });
    publishAdminAlert(updated.id, 'MAINTENANCE_STATUS', `แจ้งซ่อม #${updated.id} เปลี่ยนสถานะเป็น ${updated.status}`, updated.status);
    return updated;
  }

  static async deleteTicket(id: number) {
    try {
      return await MaintenanceRepository.deleteTicket(id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new AppError('Maintenance ticket not found', 404);
      }
      throw error;
    }
  }
}
