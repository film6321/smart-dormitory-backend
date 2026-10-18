import { Prisma } from '@prisma/client';
import { parseNotificationChannel, parseNotificationType } from './notification.dto';
import { prisma, type DbClient } from '../../database/db';

export class NotificationRepository {
  private static readonly userSelect = {
    id: true,
    email: true,
    role: true,
    createdAt: true,
    updatedAt: true,
  };

  static async findTenantById(id: number, db: DbClient = prisma) {
    return db.tenant.findUnique({
      where: { id },
      select: { id: true, phone: true, userId: true },
    });
  }

  static async findTenantByUserId(userId: number, db: DbClient = prisma) {
    return db.tenant.findUnique({
      where: { userId },
      select: { id: true, phone: true, userId: true },
    });
  }

  static async findUserById(id: number, db: DbClient = prisma) {
    return db.user.findUnique({
      where: { id },
      select: { id: true, email: true, username: true, role: true },
    });
  }

  static async listNotifications(userId?: number, db: DbClient = prisma) {
    const tenant = userId !== undefined ? await this.findTenantByUserId(userId, db) : null;
    return db.notification.findMany({
      where: userId !== undefined
        ? { OR: [{ userId }, ...(tenant ? [{ tenantId: tenant.id, userId: null }] : [])] }
        : { userId: null, tenantId: null },
      orderBy: { createdAt: 'desc' }, take: 50,
    });
  }

  static async createNotification(data: Prisma.NotificationCreateInput, db: DbClient = prisma) {
    return db.notification.create({ data });
  }

  static async listPreferences(userId?: number, db: DbClient = prisma) {
    return db.notificationPreference.findMany({ where: userId ? { userId } : undefined, orderBy: { createdAt: 'desc' } });
  }

  static async listDeadLetters(db: DbClient = prisma) {
    return db.notificationDeadLetter.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { notification: true } });
  }

  static async listAuditLogs(notificationId?: number, db: DbClient = prisma) {
    return db.notificationAuditLog.findMany({ where: notificationId ? { notificationId } : undefined, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  static async findDeadLetterById(id: number, db: DbClient = prisma) {
    return db.notificationDeadLetter.findUnique({ where: { id }, include: { notification: true } });
  }

  static async deleteDeadLetter(id: number, db: DbClient = prisma) {
    return db.notificationDeadLetter.delete({ where: { id } });
  }

  static async updateNotification(id: number, data: Prisma.NotificationUpdateInput, db: DbClient = prisma) {
    return db.notification.update({ where: { id }, data });
  }

  static async findPreference(userId: number, channel: string, db: DbClient = prisma) {
    return db.notificationPreference.findFirst({ where: { userId, channel: parseNotificationChannel(channel) } });
  }

  static async upsertPreference(data: { userId?: number; channel: string; type?: string; optedOut: boolean }, db: DbClient = prisma) {
    const channel = parseNotificationChannel(data.channel);
    const type = data.type ? parseNotificationType(data.type) : undefined;
    const existing = await db.notificationPreference.findFirst({ where: { userId: data.userId, channel, ...(type ? { type } : {}) } });

    if (existing) {
      return db.notificationPreference.update({ where: { id: existing.id }, data: { optedOut: data.optedOut } });
    }

    return db.notificationPreference.create({ data: { userId: data.userId, channel, optedOut: data.optedOut, ...(type ? { type } : {}) } });
  }

  static async findNotificationProvider(channel: string, db: DbClient = prisma) {
    return db.notificationProvider.findFirst({ where: { channel: parseNotificationChannel(channel), isActive: true } });
  }

  static async findNotificationTemplate(id: number, db: DbClient = prisma) {
    return db.notificationTemplate.findUnique({ where: { id } });
  }

  static async createAuditLog(notificationId: number, eventType: string, payload: Record<string, unknown>, db: DbClient = prisma) {
    return db.notificationAuditLog.create({ data: { notificationId, eventType, payload: JSON.stringify(payload) } });
  }

  static async createDeadLetter(notificationId: number, reason: string, details: Record<string, unknown>, db: DbClient = prisma) {
    const existing = await db.notificationDeadLetter.findFirst({ where: { notificationId } });
    if (existing) return existing;
    return db.notificationDeadLetter.create({ data: { notificationId, reason, details: JSON.stringify(details) } });
  }
}
