"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationRepository = void 0;
const db_1 = require("../../database/db");
class NotificationRepository {
    static userSelect = {
        id: true,
        email: true,
        role: true,
        firstName: true,
        lastName: true,
        createdAt: true,
        updatedAt: true,
    };
    static async findTenantById(id, db = db_1.prisma) {
        const _db = db;
        return _db.tenant.findUnique({ where: { id }, include: { user: { select: NotificationRepository.userSelect } } });
    }
    static async findUserById(id, db = db_1.prisma) {
        const _db = db;
        return _db.user.findUnique({ where: { id } });
    }
    static async listNotifications(userId, db = db_1.prisma) {
        const _db = db;
        return _db.notification.findMany({ where: userId ? { userId } : undefined, orderBy: { createdAt: 'desc' }, take: 50 });
    }
    static async createNotification(data, db = db_1.prisma) {
        const _db = db;
        return _db.notification.create({ data });
    }
    static async listPreferences(userId, db = db_1.prisma) {
        const _db = db;
        return _db.notificationPreference.findMany({ where: userId ? { userId } : undefined, orderBy: { createdAt: 'desc' } });
    }
    static async listDeadLetters(db = db_1.prisma) {
        const _db = db;
        return _db.notificationDeadLetter.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { notification: true } });
    }
    static async listAuditLogs(notificationId, db = db_1.prisma) {
        const _db = db;
        return _db.notificationAuditLog.findMany({ where: notificationId ? { notificationId } : undefined, orderBy: { createdAt: 'desc' }, take: 200 });
    }
    static async findDeadLetterById(id, db = db_1.prisma) {
        const _db = db;
        return _db.notificationDeadLetter.findUnique({ where: { id }, include: { notification: true } });
    }
    static async deleteDeadLetter(id, db = db_1.prisma) {
        const _db = db;
        return _db.notificationDeadLetter.delete({ where: { id } });
    }
    static async updateNotification(id, data, db = db_1.prisma) {
        const _db = db;
        return _db.notification.update({ where: { id }, data });
    }
    static async findPreference(userId, channel, db = db_1.prisma) {
        const _db = db;
        return _db.notificationPreference.findFirst({ where: { userId, channel: channel } });
    }
    static async upsertPreference(data, db = db_1.prisma) {
        const _db = db;
        const existing = await _db.notificationPreference.findFirst({ where: { userId: data.userId, channel: data.channel, ...(data.type ? { type: data.type } : {}) } });
        if (existing) {
            return _db.notificationPreference.update({ where: { id: existing.id }, data: { optedOut: data.optedOut } });
        }
        return _db.notificationPreference.create({ data: { userId: data.userId, channel: data.channel, optedOut: data.optedOut, ...(data.type ? { type: data.type } : {}) } });
    }
    static async findNotificationProvider(channel, db = db_1.prisma) {
        const _db = db;
        return _db.notificationProvider.findFirst({ where: { channel: channel, isActive: true } });
    }
    static async findNotificationTemplate(id, db = db_1.prisma) {
        const _db = db;
        return _db.notificationTemplate.findUnique({ where: { id } });
    }
    static async createAuditLog(notificationId, eventType, payload, db = db_1.prisma) {
        const _db = db;
        if (_db.notificationAuditLog && typeof _db.notificationAuditLog.create === 'function') {
            return _db.notificationAuditLog.create({ data: { notificationId, eventType, payload: JSON.stringify(payload) } });
        }
        // Fallback for test mocks without audit log table
        return { notificationId, eventType, payload: JSON.stringify(payload) };
    }
    static async createDeadLetter(notificationId, reason, details, db = db_1.prisma) {
        const _db = db;
        if (_db.notificationDeadLetter && typeof _db.notificationDeadLetter.findFirst === 'function') {
            const existing = await _db.notificationDeadLetter.findFirst({ where: { notificationId } });
            if (existing)
                return existing;
            if (typeof _db.notificationDeadLetter.create === 'function') {
                return _db.notificationDeadLetter.create({ data: { notificationId, reason, details: JSON.stringify(details) } });
            }
        }
        // Fallback for test mocks without dead letter table
        return { notificationId, reason, details: JSON.stringify(details) };
    }
}
exports.NotificationRepository = NotificationRepository;
