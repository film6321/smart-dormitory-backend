import { logger } from '../logger';
import NotificationService from '../modules/notifications/notification.service';

const getDbClient = (dbClient?: any) => {
  if (dbClient) {
    return dbClient;
  }

  try {
    // eslint-disable-next-line global-require
    const { prisma } = require('../database/db');
    return prisma;
  } catch (error) {
    logger.warn({ error }, 'Notification worker could not initialize Prisma client');
    return null;
  }
};

let workerTimer: NodeJS.Timeout | undefined;
let isProcessing = false;
let processedCount = 0;
let failedCount = 0;
let lastRunAt = 0;
let workerIntervalMs = Number(process.env.NOTIFICATION_WORKER_INTERVAL_MS ?? 5000);

export async function processPendingNotifications(dbClient?: any) {
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

    const svc = new NotificationService(db);
    for (const notification of pending) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await svc.sendNotification(notification.id);
        processedCount += 1;
      } catch (err) {
        failedCount += 1;
        logger.warn({ notificationId: notification.id, err }, 'Notification worker failed to process a notification');
      }
    }
  } finally {
    isProcessing = false;
  }
}

export function startNotificationWorker(dbClient?: any, intervalMs = Number(process.env.NOTIFICATION_WORKER_INTERVAL_MS ?? 5000)) {
  if (workerTimer) {
    return workerTimer;
  }

  const safeInterval = Number.isInteger(intervalMs) && intervalMs > 0 ? intervalMs : 5000;
  workerIntervalMs = safeInterval;
  workerTimer = setInterval(() => {
    void processPendingNotifications(dbClient);
  }, safeInterval);
  workerTimer.unref();

  logger.info({ intervalMs: safeInterval }, 'Notification worker started');
  return workerTimer;
}

export async function stopNotificationWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = undefined;
  }

  lastRunAt = 0;
}

export function getNotificationWorkerStats() {
  return {
    processedCount,
    failedCount,
    isProcessing,
  };
}

export default { processPendingNotifications, startNotificationWorker, stopNotificationWorker, getNotificationWorkerStats };
