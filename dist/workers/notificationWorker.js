"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processPendingNotifications = processPendingNotifications;
exports.startNotificationWorker = startNotificationWorker;
exports.stopNotificationWorker = stopNotificationWorker;
exports.getNotificationWorkerStats = getNotificationWorkerStats;
const logger_1 = require("../logger");
const notification_service_1 = __importDefault(require("../modules/notifications/notification.service"));
const getDbClient = (dbClient) => {
    if (dbClient) {
        return dbClient;
    }
    try {
        const { prisma } = require('../database/db');
        return prisma;
    }
    catch (error) {
        logger_1.logger.warn({ error }, 'Notification worker could not initialize Prisma client');
        return null;
    }
};
let workerTimer;
let isProcessing = false;
let processedCount = 0;
let failedCount = 0;
let lastRunAt = 0;
let workerIntervalMs = Number(process.env.NOTIFICATION_WORKER_INTERVAL_MS ?? 5000);
async function processPendingNotifications(dbClient) {
    if (isProcessing) {
        return;
    }
    const now = Date.now();
    if (lastRunAt && now - lastRunAt < workerIntervalMs) {
        return;
    }
    lastRunAt = now;
    isProcessing = true;
    try {
        const db = getDbClient(dbClient);
        if (!db) {
            return;
        }
        const now = new Date();
        const pending = await db.notification.findMany({
            where: {
                status: 'PENDING',
                OR: [
                    { scheduledAt: null },
                    { scheduledAt: { lte: now } }
                ]
            },
            take: 50,
            orderBy: { scheduledAt: 'asc' }
        });
        if (pending.length === 0) {
            return;
        }
        const svc = new notification_service_1.default(db);
        for (const notification of pending) {
            try {
                await svc.sendNotification(notification.id);
                processedCount += 1;
            }
            catch (err) {
                failedCount += 1;
                logger_1.logger.warn({ notificationId: notification.id, err }, 'Notification worker failed to process a notification');
            }
        }
    }
    finally {
        isProcessing = false;
    }
}
function startNotificationWorker(dbClient, intervalMs = Number(process.env.NOTIFICATION_WORKER_INTERVAL_MS ?? 5000)) {
    if (workerTimer) {
        return workerTimer;
    }
    const safeInterval = Number.isInteger(intervalMs) && intervalMs > 0 ? intervalMs : 5000;
    workerIntervalMs = safeInterval;
    workerTimer = setInterval(() => {
        void processPendingNotifications(dbClient);
    }, safeInterval);
    workerTimer.unref();
    logger_1.logger.info({ intervalMs: safeInterval }, 'Notification worker started');
    return workerTimer;
}
async function stopNotificationWorker() {
    if (workerTimer) {
        clearInterval(workerTimer);
        workerTimer = undefined;
    }
    lastRunAt = 0;
}
function getNotificationWorkerStats() {
    return {
        processedCount,
        failedCount,
        isProcessing,
    };
}
exports.default = { processPendingNotifications, startNotificationWorker, stopNotificationWorker, getNotificationWorkerStats };
