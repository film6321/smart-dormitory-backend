import NotificationService from '../notifications/notification.service';
import { MaintenanceRepository } from './maintenance.repository';
import { Prisma, MaintenanceCategory, MaintenanceStatus } from '@prisma/client';
import { prisma } from '../../database/db';
import { AppError } from '../../middlewares/error-handler';
import { publishAdminAlert } from '../../realtime/notification-gateway';
import { logger } from '../../logger';
import { canTransitionMaintenanceStatus } from '../../shared/state-transitions';

export class MaintenanceService {
  static async getTenantByUserId(userId: number) {
    return prisma.tenant.findFirst({ where: { userId } });
  }

  static async getTicketById(id: number) {
    return MaintenanceRepository.getTicketById(id);
  }

  static async createTicket(data: { tenantId: number; roomId?: number; category: string; description: string; contactTime?: Date }) {
    const category = Object.values(MaintenanceCategory).find((value) => value === data.category);
    if (category === undefined) {
      throw new AppError('Invalid maintenance category', 400);
    }

    const ticket = await MaintenanceRepository.createTicketWithinDailyLimit({
      tenant: { connect: { id: data.tenantId } },
      room: data.roomId ? { connect: { id: data.roomId } } : undefined,
      category,
      description: data.description,
      contactTime: data.contactTime,
    }, data.tenantId);

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
      logger.warn({ err: notifErr }, '[MaintenanceService] Notification scheduling failed (non-critical)');
    }

    return ticket;
  }

  static async listTickets(userId?: number, role?: string) {
    return MaintenanceRepository.listTickets(userId, role);
  }

  static async updateTicketStatus(id: number, status: string, note?: string) {
    const validatedStatus = Object.values(MaintenanceStatus).find((value) => value === status);
    if (validatedStatus === undefined) {
      throw new AppError('Invalid maintenance status', 400);
    }

    const existingTicket = await MaintenanceRepository.getTicketById(id);
    if (!existingTicket) {
      throw new AppError('Maintenance ticket not found', 404);
    }
    if (!canTransitionMaintenanceStatus(existingTicket.status, validatedStatus)) {
      throw new AppError('Invalid maintenance state transition', 409);
    }

    try {
      const updated = await MaintenanceRepository.updateTicketStatus(id, {
        status: validatedStatus,
        note,
      });
      publishAdminAlert(updated.id, 'MAINTENANCE_STATUS', `แจ้งซ่อม #${updated.id} เปลี่ยนสถานะเป็น ${updated.status}`, updated.status);
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        const current = await MaintenanceRepository.getTicketById(id);
        throw new AppError(current ? 'Maintenance ticket is resolved, closed or cancelled' : 'Maintenance ticket not found', current ? 409 : 404);
      }
      throw error;
    }
  }

  static async deleteTicket(id: number) {
    const ticket = await MaintenanceRepository.getTicketById(id);
    if (!ticket) {
      throw new AppError('Maintenance ticket not found', 404);
    }
    if (ticket.status === MaintenanceStatus.RESOLVED || ticket.status === MaintenanceStatus.CLOSED || ticket.status === MaintenanceStatus.CANCELLED) {
      throw new AppError('Resolved, closed or cancelled maintenance tickets cannot be deleted', 409);
    }
    try {
      return await MaintenanceRepository.deleteTicket(id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        const current = await MaintenanceRepository.getTicketById(id);
        throw new AppError(current ? 'Resolved, closed or cancelled maintenance tickets cannot be deleted' : 'Maintenance ticket not found', current ? 409 : 404);
      }
      throw error;
    }
  }
}
