import { requestBody } from '../../shared/input';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import NotificationService from '../notifications/notification.service';
import { MaintenanceRepository } from './maintenance.repository';
import { Prisma, MaintenanceCategory, MaintenanceStatus } from '@prisma/client';
import { prisma } from '../../database/db';
import { AppError } from '../../middlewares/error-handler';
import { publishAdminAlert } from '../../realtime/notification-gateway';
import { logger } from '../../logger';
import { canTransitionMaintenanceStatus } from '../../shared/state-transitions';

export class MaintenanceService {
  static async uploadImage(file: Express.Multer.File, userId: number) {
    const tenant = await this.getTenantByUserId(userId);
    if (!tenant || !tenant.isActive || !['ACTIVE', 'APPROVED'].includes(tenant.status) || !tenant.roomId) throw new AppError('ต้องเป็นผู้พักที่มีห้องก่อนอัปโหลดภาพแจ้งซ่อม', 403);
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype];
    if (!ext) throw new AppError('Only JPG, PNG, and WebP images are allowed', 400);
    const filename = `${randomUUID()}${ext}`;
    const root = path.resolve(process.env.UPLOAD_ROOT || 'uploads/maintenance');
    await fs.mkdir(root, { recursive: true });
    const target = path.join(root, filename);
    await fs.writeFile(target, file.buffer);
    try {
      await prisma.systemSetting.create({ data: { key: `maintenance-upload:${filename}`, category: 'MAINTENANCE_UPLOAD', updatedById: userId,
        value: JSON.stringify({ expiresAt: new Date(Date.now() + 86400000).toISOString() }) } });
    } catch (error) { await fs.unlink(target).catch(() => undefined); throw error; }
    return { filename };
  }

  static async cleanupExpiredUploads(now = new Date()) {
    const rows = await prisma.systemSetting.findMany({ where: { category: 'MAINTENANCE_UPLOAD' } });
    for (const row of rows) {
      if (new Date(String(requestBody(JSON.parse(row.value)).expiresAt)).getTime() > now.getTime()) continue;
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "SystemSetting" WHERE id = ${row.id} FOR UPDATE`;
        if (!await tx.systemSetting.findUnique({ where: { id: row.id } })) return;
        const filename = row.key.slice('maintenance-upload:'.length);
        if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(filename)) throw new Error('Invalid staged maintenance filename');
        const referenced = await tx.maintenanceTicket.count({ where: { description: { startsWith: `[IMAGE:${filename}]` } } });
        if (!referenced) {
          const root = path.resolve(process.env.UPLOAD_ROOT || 'uploads/maintenance');
          const target = path.join(root, filename);
          try {
            const actualRoot = await fs.realpath(root); const actual = await fs.realpath(target);
            if (!actual.startsWith(actualRoot + path.sep) || (await fs.lstat(target)).isSymbolicLink()) throw new Error('Unsafe staged upload path');
            await fs.unlink(target);
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        await tx.systemSetting.delete({ where: { id: row.id } });
      });
    }
  }

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
        type: 'GENERIC',
        payload: JSON.stringify({ message: `Maintenance ticket ${ticket.id} created`, category: ticket.category }),
      });
    } catch (notifErr) {
      // Log but don't propagate - ticket is already saved
      logger.warn({ err: notifErr }, '[MaintenanceService] Notification scheduling failed (non-critical)');
    }

    publishAdminAlert(ticket.id, 'MAINTENANCE_STATUS', `มีแจ้งซ่อมใหม่ #${ticket.id} รอรับงาน`, ticket.status);
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

  static async confirmTicket(id: number, userId: number) {
    const result = await MaintenanceRepository.confirmTicket(id, userId);
    if (result.changed) publishAdminAlert(result.ticket.id, 'MAINTENANCE_STATUS', `ผู้พักยืนยันปิดงานแจ้งซ่อม #${id}`, 'CLOSED');
    return result.ticket;
  }
}
