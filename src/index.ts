import app from './app';
import { prisma } from './database/db';
import { logger } from './logger';
import { disconnectRedis } from './shared/redis';
import { startAccessLogWorker, stopAccessLogWorker } from './workers/accessLogQueue';
import { startOcrJobWorker, stopOcrJobWorker } from './workers/ocrJobWorker';
import { startNotificationWorker, stopNotificationWorker } from './workers/notificationWorker';

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  startAccessLogWorker();
  startOcrJobWorker();
  startNotificationWorker();
  logger.info(`Backend API Gateway is running on http://localhost:${PORT}`);
});

const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    await stopOcrJobWorker();
    await stopAccessLogWorker();
    await stopNotificationWorker();
    await disconnectRedis();
    await prisma.$disconnect();
    logger.info('HTTP server, Redis, and database connections closed.');
    process.exit(0);
  });
};

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
