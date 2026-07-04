import { logger } from '../../logger';

export class NotificationService {
  private db: any;

  constructor(dbClient?: any) {
    this.db = dbClient;
  }

  private async resolveRecipientPhone(data: any) {
    const db = this.getDb();
    if (data.recipientPhone) {
      return data.recipientPhone;
    }

    if (data.tenantId) {
      const tenant = await db.tenant.findUnique({ where: { id: data.tenantId }, include: { user: true } });
      if (tenant?.phone) {
        return tenant.phone;
      }
      if (tenant?.user?.phone) {
        return tenant.user.phone;
      }
    }

    if (data.userId) {
      const user = await db.user.findUnique({ where: { id: data.userId } });
      if (user?.phone) {
        return user.phone;
      }
    }

    return null;
  }

  private getDb() {
    if (!this.db) {
      // lazy-load prisma to avoid requiring DB during unit tests
      // eslint-disable-next-line global-require
      const { prisma } = require('../../database/db');
      this.db = prisma;
    }
    return this.db;
  }

  async listNotifications(userId?: number) {
    return this.getDb().notification.findMany({
      where: userId ? { userId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async scheduleNotification(data: any) {
    const recipientPhone = await this.resolveRecipientPhone(data);
    const payload = { ...data, recipientPhone };
    return this.getDb().notification.create({ data: payload });
  }

  async listPreferences(userId?: number) {
    const db = this.getDb();
    return db.notificationPreference.findMany({
      where: userId ? { userId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async listDeadLetters() {
    return this.getDb().notificationDeadLetter.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { notification: true },
    });
  }

  async listAuditLogs(notificationId?: number) {
    return this.getDb().notificationAuditLog.findMany({
      where: notificationId ? { notificationId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async retryDeadLetter(deadLetterId: number) {
    const db = this.getDb();
    const deadLetter = await db.notificationDeadLetter.findUnique({ where: { id: deadLetterId }, include: { notification: true } });
    if (!deadLetter?.notification) {
      throw new Error('Dead letter not found');
    }

    await db.notificationDeadLetter.delete({ where: { id: deadLetterId } });
    await db.notification.update({ where: { id: deadLetter.notification.id }, data: { status: 'PENDING', lastError: null } });
    await this.createAuditLog(db, deadLetter.notification.id, 'DEAD_LETTER_RETRIED', { deadLetterId });

    return this.sendNotification(deadLetter.notification.id);
  }

  async deleteDeadLetter(deadLetterId: number) {
    const db = this.getDb();
    const deadLetter = await db.notificationDeadLetter.findUnique({ where: { id: deadLetterId } });
    if (!deadLetter) {
      throw new Error('Dead letter not found');
    }

    await db.notificationDeadLetter.delete({ where: { id: deadLetterId } });
    return { deleted: true, id: deadLetterId };
  }

  async upsertPreference(data: { userId?: number; channel: string; type?: string; optedOut: boolean }) {
    const db = this.getDb();
    const existing = await db.notificationPreference.findFirst({
      where: {
        userId: data.userId,
        channel: data.channel as any,
        ...(data.type ? { type: data.type as any } : {}),
      },
    });
    if (existing) {
      return db.notificationPreference.update({ where: { id: existing.id }, data: { optedOut: data.optedOut } });
    }
    return db.notificationPreference.create({
      data: {
        userId: data.userId,
        channel: data.channel as any,
        optedOut: data.optedOut,
        ...(data.type ? { type: data.type as any } : {}),
      },
    });
  }

  private async createAuditLog(db: any, notificationId: number, eventType: string, payload: Record<string, unknown>) {
    return db.notificationAuditLog?.create({
      data: {
        notificationId,
        eventType,
        payload: JSON.stringify(payload),
      },
    });
  }

  private async createDeadLetter(db: any, notificationId: number, reason: string, details: Record<string, unknown>) {
    const existing = await db.notificationDeadLetter?.findFirst({ where: { notificationId } });
    if (existing) {
      return existing;
    }

    return db.notificationDeadLetter?.create({
      data: {
        notificationId,
        reason,
        details: JSON.stringify(details),
      },
    });
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
    const db = this.getDb();
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

    const providerModule = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER
      ? require('./provider/twilioProvider')
      : require('./provider/simpleProvider');
    try {
      const result = await this.sendWithRetry({ ...notif, body }, providerModule, provider);
      await db.notification.update({ where: { id: notificationId }, data: { status: 'SENT', providerMessageId: result.id, attempts: (notif.attempts ?? 0) + 1, sentAt: new Date() } });
      await this.createAuditLog(db, notificationId, 'DELIVERY_SENT', { providerMessageId: result.id, status: 'SENT' });
      return result;
    } catch (err: any) {
      const nextAttempts = (notif.attempts ?? 0) + 1;
      await db.notification.update({ where: { id: notificationId }, data: { status: 'FAILED', lastError: String(err?.message ?? err), attempts: nextAttempts } });
      await this.createAuditLog(db, notificationId, 'DELIVERY_FAILED', { error: String(err?.message ?? err), attempts: nextAttempts });

      if (nextAttempts >= 3) {
        await this.createDeadLetter(db, notificationId, 'max_retries_exceeded', { error: String(err?.message ?? err), attempts: nextAttempts });
      }

      throw err;
    }
  }

  async handleProviderWebhook(payload: Record<string, any>) {
    const db = this.getDb();
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
    await this.createAuditLog(db, notification.id, 'PROVIDER_WEBHOOK', { status, payload });

    if (newStatus === 'FAILED') {
      await this.createDeadLetter(db, notification.id, status, { payload });
    }

    return { id: notification.id, status: newStatus };
  }
}

export default NotificationService;
