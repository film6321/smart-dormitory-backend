import { requestBody } from '../../shared/input';
import { MaintenanceStatus, Prisma } from '@prisma/client';
import { prisma } from '../../database/db';
import { AppError } from '../../middlewares/error-handler';
import { canTransitionMaintenanceStatus } from '../../shared/state-transitions';

export class MaintenanceRepository {
  static async createTicketWithinDailyLimit(data: Prisma.MaintenanceTicketCreateInput, tenantId: number, now = new Date(), db = prisma) {
    return db.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { userId: true } });
      if (!tenant?.userId) throw new AppError('Tenant account not found', 404);
      // Lock the account until commit so concurrent requests share the same quota.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${tenant.userId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${tenantId} FOR UPDATE`;
      const currentTenant = await tx.tenant.findUnique({
        where: { id: tenantId }, select: { userId: true, roomId: true, status: true, isActive: true },
      });
      if (!currentTenant || currentTenant.userId !== tenant.userId || !currentTenant.isActive
        || !['ACTIVE', 'APPROVED'].includes(currentTenant.status) || currentTenant.roomId === null) {
        throw new AppError('ต้องเป็นผู้พักที่ยังมีสิทธิ์และมีห้องก่อนส่งแจ้งซ่อม', 403);
      }
      const requestedRoomId = data.room?.connect?.id;
      if (requestedRoomId !== undefined && requestedRoomId !== currentTenant.roomId) {
        throw new AppError('ส่งแจ้งซ่อมได้เฉพาะห้องที่ตนพักอยู่', 403);
      }
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
      const imageMatch = /^\[IMAGE:([^\]]+)\]/u.exec(data.description);
      let imageRecord: { id: number } | null = null;
      if (imageMatch) {
        const key = `maintenance-upload:${imageMatch[1]}`;
        await tx.$queryRaw`SELECT id FROM "SystemSetting" WHERE key = ${key} FOR UPDATE`;
        const staged = await tx.systemSetting.findUnique({ where: { key } });
        if (!staged || staged.category !== 'MAINTENANCE_UPLOAD' || staged.updatedById !== tenant.userId
          || new Date(String(requestBody(JSON.parse(staged.value)).expiresAt)).getTime() <= now.getTime()) throw new AppError('ภาพแจ้งซ่อมไม่ใช่ของบัญชีนี้หรือหมดอายุ กรุณาอัปโหลดใหม่', 400);
        imageRecord = staged;
      }
      const ticket = await tx.maintenanceTicket.create({
        data: { ...data, room: { connect: { id: currentTenant.roomId } } },
      });
      if (imageRecord) await tx.systemSetting.delete({ where: { id: imageRecord.id } });
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
      ? { tenant: { status: { not: 'ARCHIVED' } } }
      : { tenant: { userId, status: { not: 'ARCHIVED' } } };

    return db.maintenanceTicket.findMany({
      where,
      include: { tenant: true, room: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async updateTicketStatus(id: number, data: Prisma.MaintenanceTicketUpdateInput, db = prisma) {
    const allowedStatuses = Object.values(MaintenanceStatus).filter(status =>
      typeof data.status === 'string' && canTransitionMaintenanceStatus(status, data.status));
    return db.maintenanceTicket.update({
      where: { id, status: { in: allowedStatuses } }, data,
    });
  }

  static async confirmTicket(id: number, userId: number, db = prisma) {
    return db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "MaintenanceTicket" WHERE "id" = ${id} FOR UPDATE`;
      const ticket = await tx.maintenanceTicket.findUnique({ where: { id }, include: { tenant: { select: { userId: true } } } });
      if (!ticket || ticket.tenant.userId !== userId) throw new AppError('Maintenance ticket not found', 404);
      if (ticket.status === MaintenanceStatus.CLOSED) return { ticket, changed: false };
      if (ticket.status !== MaintenanceStatus.RESOLVED) throw new AppError('ยืนยันปิดงานได้เมื่อซ่อมเสร็จแล้วเท่านั้น', 409);
      const updated = await tx.maintenanceTicket.update({ where: { id, status: MaintenanceStatus.RESOLVED }, data: { status: MaintenanceStatus.CLOSED } });
      return { ticket: updated, changed: true };
    });
  }

  static async deleteTicket(id: number, db = prisma) {
    return db.maintenanceTicket.delete({
      where: { id, status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] } },
    });
  }
}
