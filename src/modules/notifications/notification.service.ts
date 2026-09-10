import { logger } from '../../logger';
import { prisma } from '../../database/db';
import { NotificationRepository } from './notification.repository';
import { Prisma } from '@prisma/client';
import { publishNotificationAlert } from '../../realtime/notification-gateway';

export class NotificationService {
  // Service uses static repository methods on NotificationRepository
  private db: any;
  private providerModule?: any;

  constructor(db?: any, providerModule?: any) {
    this.db = db ?? (prisma as any);
    this.providerModule = providerModule;
  }

  private async resolveRecipientPhone(data: any) {
    if (data.recipientPhone) return data.recipientPhone;

    if (data.tenantId) {
      const tenant = await NotificationRepository.findTenantById(data.tenantId, this.db);
      if (tenant?.phone) return tenant.phone;
    }

    if (data.userId) {
      const tenant = await NotificationRepository.findTenantByUserId(data.userId, this.db);
      if (tenant?.phone) return tenant.phone;
    }

    return null;
  }

  async listNotifications(userId?: number) {
    return NotificationRepository.listNotifications(userId, this.db);
  }

  async scheduleNotification(data: any) {
    const tenant = data.tenantId ? await NotificationRepository.findTenantById(data.tenantId, this.db) : null;
    const recipientPhone = data.recipientPhone ?? tenant?.phone ?? null;
    const payload = { ...data, recipientPhone };
    const notification = await NotificationRepository.createNotification(payload as Prisma.NotificationCreateInput, this.db);
    publishNotificationAlert(notification);
    return notification;
  }

  async listPreferences(userId?: number) {
    return NotificationRepository.listPreferences(userId, this.db);
  }

  async listDeadLetters() {
    return NotificationRepository.listDeadLetters(this.db);
  }

  async listAuditLogs(notificationId?: number) {
    return NotificationRepository.listAuditLogs(notificationId, this.db);
  }

  async retryDeadLetter(deadLetterId: number) {
    const deadLetter = await NotificationRepository.findDeadLetterById(deadLetterId, this.db);
    if (!deadLetter?.notification) {
      throw new Error('Dead letter not found');
    }
    await NotificationRepository.deleteDeadLetter(deadLetterId, this.db);
    await NotificationRepository.updateNotification(deadLetter.notification.id, { status: 'PENDING', lastError: null }, this.db);
    await NotificationRepository.createAuditLog(deadLetter.notification.id, 'DEAD_LETTER_RETRIED', { deadLetterId }, this.db);

    return this.sendNotification(deadLetter.notification.id);
  }

  async deleteDeadLetter(deadLetterId: number) {
    const deadLetter = await NotificationRepository.findDeadLetterById(deadLetterId, this.db);
    if (!deadLetter) {
      throw new Error('Dead letter not found');
    }
    await NotificationRepository.deleteDeadLetter(deadLetterId, this.db);
    return { deleted: true, id: deadLetterId };
  }

  async upsertPreference(data: { userId?: number; channel: string; type?: string; optedOut: boolean }) {
    return NotificationRepository.upsertPreference(data, this.db);
  }

  private async createAuditLog(notificationId: number, eventType: string, payload: Record<string, unknown>) {
    return NotificationRepository.createAuditLog(notificationId, eventType, payload, this.db);
  }

  private async createDeadLetter(notificationId: number, reason: string, details: Record<string, unknown>) {
    return NotificationRepository.createDeadLetter(notificationId, reason, details, this.db);
  }

  private async getProviderModule() {
    if (this.providerModule) return this.providerModule;
    return process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER
      ? require('./provider/twilioProvider')
      : require('./provider/simpleProvider');
  }

  private async sendWithRetry(notif: any, providerModule: any, provider: any) {
    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        logger.info({ notificationId: notif.id, attempt }, 'Attempting notification send');
        return await providerModule.send(provider, { ...notif, body: notif.body ?? notif.payload ?? '' });
      } catch (error) {
        lastError = error;
        logger.warn({ notificationId: notif.id, attempt, error }, 'Notification send failed, retrying');
        if (attempt < maxAttempts) {
          const delayMs = 1000 * 2 ** (attempt - 1);
          logger.info({ notificationId: notif.id, attempt, delayMs }, 'Backoff before retry');
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    throw lastError;
  }

  // Send a single notification by id. Uses a simple provider stub.
  async sendNotification(notificationId: number) {
    const db = this.db;
    const notif = await db.notification.findUnique({ where: { id: notificationId } });
    if (!notif) throw new Error('Notification not found');

    // Check preferences
    if (notif.userId) {
      const pref = await db.notificationPreference.findFirst({ where: { userId: notif.userId, channel: notif.channel } });
      if (pref?.optedOut) {
        await db.notification.update({ where: { id: notificationId }, data: { status: 'CANCELLED' } });
        return { cancelled: true };
      }
    }

    const provider = await db.notificationProvider.findFirst({ where: { channel: notif.channel, isActive: true } });
    // Simple template resolution (if template exists, use its body)
    let body = notif.payload ?? '';
    if (!body && notif.templateId) {
      const tmpl = await db.notificationTemplate.findUnique({ where: { id: notif.templateId } });
      body = tmpl?.body ?? '';
    }

    const providerModule = await this.getProviderModule();
    try {
      const result = await this.sendWithRetry({ ...notif, body }, providerModule, provider);
      await db.notification.update({ where: { id: notificationId }, data: { status: 'SENT', providerMessageId: result.id, attempts: (notif.attempts ?? 0) + 1, sentAt: new Date() } });
      await this.createAuditLog(notificationId, 'DELIVERY_SENT', { providerMessageId: result.id, status: 'SENT' });
      return result;
    } catch (err: any) {
      const nextAttempts = (notif.attempts ?? 0) + 1;
      await db.notification.update({ where: { id: notificationId }, data: { status: 'FAILED', lastError: String(err?.message ?? err), attempts: nextAttempts } });
      await this.createAuditLog(notificationId, 'DELIVERY_FAILED', { error: String(err?.message ?? err), attempts: nextAttempts });

      if (nextAttempts >= 3) {
        await this.createDeadLetter(notificationId, 'max_retries_exceeded', { error: String(err?.message ?? err), attempts: nextAttempts });
      }

      throw err;
    }
  }

  async handleProviderWebhook(payload: Record<string, any>) {
    const db = this.db;
    const notification = await db.notification.findFirst({ where: { providerMessageId: payload.MessageSid ?? payload.messageSid } });
    if (!notification) {
      return null;
    }

    const status = payload.MessageStatus ?? payload.messageStatus ?? 'unknown';
    const statusMap: Record<string, string> = {
      queued: 'PENDING',
      sent: 'SENT',
      delivered: 'SENT',
      failed: 'FAILED',
      undelivered: 'FAILED',
      cancelled: 'CANCELLED',
    };

    const newStatus = statusMap[status] ?? 'FAILED';
    await db.notification.update({ where: { id: notification.id }, data: { status: newStatus } });
    await this.createAuditLog(notification.id, 'PROVIDER_WEBHOOK', { status, payload });

    if (newStatus === 'FAILED') {
      await this.createDeadLetter(notification.id, status, { payload });
    }

    return { id: notification.id, status: newStatus };
  }
}

export default NotificationService;
