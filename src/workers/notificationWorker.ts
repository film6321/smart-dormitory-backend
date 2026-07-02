import { prisma } from '../database/db';
import NotificationService from '../modules/notifications/notification.service';

export async function processPendingNotifications(dbClient?: any) {
  const db = dbClient ?? prisma;
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

  const svc = new NotificationService(db);
  for (const n of pending) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await svc.sendNotification(n.id);
    } catch (err) {
      // continue processing others
    }
  }
}

export default { processPendingNotifications };
