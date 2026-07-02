export class NotificationService {
  private db: any;

  constructor(dbClient?: any) {
    if (dbClient) {
      this.db = dbClient;
    } else {
      // lazy-load prisma to avoid requiring DB during unit tests
      // eslint-disable-next-line global-require
      const { prisma } = require('../../database/db');
      this.db = prisma;
    }
  }

  async scheduleNotification(data: any) {
    return this.db.notification.create({ data });
  }

  // Send a single notification by id. Uses a simple provider stub.
  async sendNotification(notificationId: number) {
    const notif = await this.db.notification.findUnique({ where: { id: notificationId } });
    if (!notif) throw new Error('Notification not found');

    // Check preferences
    if (notif.userId) {
      const pref = await this.db.notificationPreference.findFirst({ where: { userId: notif.userId, channel: notif.channel } });
      if (pref?.optedOut) {
        await this.db.notification.update({ where: { id: notificationId }, data: { status: 'CANCELLED' } });
        return { cancelled: true };
      }
    }

    const provider = await this.db.notificationProvider.findFirst({ where: { channel: notif.channel, isActive: true } });
    // Simple template resolution (if template exists, use its body)
    let body = notif.payload ?? '';
    if (!body && notif.templateId) {
      const tmpl = await this.db.notificationTemplate.findUnique({ where: { id: notif.templateId } });
      body = tmpl?.body ?? '';
    }

    // Use local provider stub (keeps things simple)
    const providerModule = require('./provider/simpleProvider');
    try {
      const result = await providerModule.send(provider, { ...notif, body });
      await this.db.notification.update({ where: { id: notificationId }, data: { status: 'SENT', providerMessageId: result.id, attempts: (notif.attempts ?? 0) + 1, sentAt: new Date() } });
      return result;
    } catch (err: any) {
      await this.db.notification.update({ where: { id: notificationId }, data: { status: 'FAILED', lastError: String(err?.message ?? err), attempts: (notif.attempts ?? 0) + 1 } });
      throw err;
    }
  }
}

export default NotificationService;
