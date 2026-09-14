"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationService = void 0;
const logger_1 = require("../../logger");
const db_1 = require("../../database/db");
const notification_repository_1 = require("./notification.repository");
const notification_gateway_1 = require("../../realtime/notification-gateway");
class NotificationService {
    db;
    providerModule;
    constructor(db, providerModule) {
        this.db = db ?? db_1.prisma;
        this.providerModule = providerModule;
    }
    async resolveRecipientPhone(data) {
        if (data.recipientPhone)
            return data.recipientPhone;
        if (data.tenantId) {
            const tenant = await notification_repository_1.NotificationRepository.findTenantById(data.tenantId, this.db);
            if (tenant?.phone)
                return tenant.phone;
        }
        if (data.userId) {
            const tenant = await notification_repository_1.NotificationRepository.findTenantByUserId(data.userId, this.db);
            if (tenant?.phone)
                return tenant.phone;
        }
        return null;
    }
    async listNotifications(userId) {
        return notification_repository_1.NotificationRepository.listNotifications(userId, this.db);
    }
    async scheduleNotification(data) {
        const tenant = data.tenantId ? await notification_repository_1.NotificationRepository.findTenantById(data.tenantId, this.db) : null;
        const recipientPhone = data.recipientPhone ?? tenant?.phone ?? null;
        const payload = {
            channel: data.channel,
            type: data.type,
            payload: data.payload,
            recipientPhone,
            scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
            ...(data.userId ? { user: { connect: { id: data.userId } } } : {}),
            ...(data.tenantId ? { tenant: { connect: { id: data.tenantId } } } : {}),
        };
        const notification = await notification_repository_1.NotificationRepository.createNotification(payload, this.db);
        (0, notification_gateway_1.publishNotificationAlert)(notification);
        return notification;
    }
    async listPreferences(userId) {
        return notification_repository_1.NotificationRepository.listPreferences(userId, this.db);
    }
    async listDeadLetters() {
        return notification_repository_1.NotificationRepository.listDeadLetters(this.db);
    }
    async listAuditLogs(notificationId) {
        return notification_repository_1.NotificationRepository.listAuditLogs(notificationId, this.db);
    }
    async retryDeadLetter(deadLetterId) {
        const deadLetter = await notification_repository_1.NotificationRepository.findDeadLetterById(deadLetterId, this.db);
        if (!deadLetter?.notification) {
            throw new Error('Dead letter not found');
        }
        await notification_repository_1.NotificationRepository.deleteDeadLetter(deadLetterId, this.db);
        await notification_repository_1.NotificationRepository.updateNotification(deadLetter.notification.id, { status: 'PENDING', lastError: null }, this.db);
        await notification_repository_1.NotificationRepository.createAuditLog(deadLetter.notification.id, 'DEAD_LETTER_RETRIED', { deadLetterId }, this.db);
        return this.sendNotification(deadLetter.notification.id);
    }
    async deleteDeadLetter(deadLetterId) {
        const deadLetter = await notification_repository_1.NotificationRepository.findDeadLetterById(deadLetterId, this.db);
        if (!deadLetter) {
            throw new Error('Dead letter not found');
        }
        await notification_repository_1.NotificationRepository.deleteDeadLetter(deadLetterId, this.db);
        return { deleted: true, id: deadLetterId };
    }
    async upsertPreference(data) {
        return notification_repository_1.NotificationRepository.upsertPreference(data, this.db);
    }
    async createAuditLog(notificationId, eventType, payload) {
        return notification_repository_1.NotificationRepository.createAuditLog(notificationId, eventType, payload, this.db);
    }
    async createDeadLetter(notificationId, reason, details) {
        return notification_repository_1.NotificationRepository.createDeadLetter(notificationId, reason, details, this.db);
    }
    async getProviderModule() {
        if (this.providerModule)
            return this.providerModule;
        return process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER
            ? require('./provider/twilioProvider')
            : require('./provider/simpleProvider');
    }
    async sendWithRetry(notif, providerModule, provider) {
        const maxAttempts = 3;
        let lastError;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                logger_1.logger.info({ notificationId: notif.id, attempt }, 'Attempting notification send');
                return await providerModule.send(provider, { ...notif, body: notif.body ?? notif.payload ?? '' });
            }
            catch (error) {
                lastError = error;
                logger_1.logger.warn({ notificationId: notif.id, attempt, error }, 'Notification send failed, retrying');
                if (attempt < maxAttempts) {
                    const delayMs = 1000 * 2 ** (attempt - 1);
                    logger_1.logger.info({ notificationId: notif.id, attempt, delayMs }, 'Backoff before retry');
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                }
            }
        }
        throw lastError;
    }
    // Send a single notification by id. Uses a simple provider stub.
    async sendNotification(notificationId) {
        const db = this.db;
        const notif = await db.notification.findUnique({ where: { id: notificationId } });
        if (!notif)
            throw new Error('Notification not found');
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
        }
        catch (err) {
            const errorObj = err;
            const errorMessage = errorObj?.message || String(err);
            const nextAttempts = (notif.attempts ?? 0) + 1;
            await db.notification.update({ where: { id: notificationId }, data: { status: 'FAILED', lastError: errorMessage, attempts: nextAttempts } });
            await this.createAuditLog(notificationId, 'DELIVERY_FAILED', { error: errorMessage, attempts: nextAttempts });
            if (nextAttempts >= 3) {
                await this.createDeadLetter(notificationId, 'max_retries_exceeded', { error: errorMessage, attempts: nextAttempts });
            }
            throw err;
        }
    }
    async handleProviderWebhook(payload) {
        const db = this.db;
        const providerMessageId = (payload.MessageSid ?? payload.messageSid);
        if (!providerMessageId)
            return null;
        const notification = await db.notification.findFirst({ where: { providerMessageId } });
        if (!notification) {
            return null;
        }
        const status = String(payload.MessageStatus ?? payload.messageStatus ?? 'unknown');
        const statusMap = {
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
exports.NotificationService = NotificationService;
exports.default = NotificationService;
