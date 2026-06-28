import { Prisma } from '@prisma/client';
import { prisma } from '../database/db';
import { logger } from '../logger';
import { getRedisClient } from '../shared/redis';

export interface AccessLogJob {
  method: string;
  path: string;
  ip?: string;
  userId?: number;
  duration?: number;
  createdAt: string;
}

const accessLogQueueKey = process.env.ACCESS_LOG_QUEUE_KEY || 'dormitory:access-logs';
const accessLogBatchSize = Number(process.env.ACCESS_LOG_BATCH_SIZE ?? 100);
const accessLogFlushIntervalMs = Number(process.env.ACCESS_LOG_FLUSH_INTERVAL_MS ?? 1000);

let flushTimer: NodeJS.Timeout | undefined;
let isFlushing = false;

const getSafeBatchSize = (): number => {
  if (!Number.isInteger(accessLogBatchSize) || accessLogBatchSize < 1) {
    return 100;
  }

  return Math.min(accessLogBatchSize, 1000);
};

const getSafeFlushIntervalMs = (): number => {
  if (!Number.isInteger(accessLogFlushIntervalMs) || accessLogFlushIntervalMs < 250) {
    return 1000;
  }

  return accessLogFlushIntervalMs;
};

export const enqueueAccessLog = async (job: AccessLogJob): Promise<void> => {
  await getRedisClient().rpush(accessLogQueueKey, JSON.stringify(job));
};

const toAccessLogInput = (job: AccessLogJob): Prisma.AccessLogCreateManyInput => ({
  method: job.method,
  path: job.path,
  ip: job.ip,
  userId: job.userId,
  duration: job.duration,
  createdAt: new Date(job.createdAt),
});

export const flushAccessLogQueue = async (): Promise<void> => {
  if (isFlushing) {
    return;
  }

  isFlushing = true;

  try {
    const redis = getRedisClient();
    const batchSize = getSafeBatchSize();
    const jobs: Prisma.AccessLogCreateManyInput[] = [];

    for (let index = 0; index < batchSize; index += 1) {
      const rawJob = await redis.lpop(accessLogQueueKey);

      if (!rawJob) {
        break;
      }

      try {
        jobs.push(toAccessLogInput(JSON.parse(rawJob) as AccessLogJob));
      } catch (error) {
        logger.warn({ error }, 'Dropped malformed access log job');
      }
    }

    if (jobs.length > 0) {
      await prisma.accessLog.createMany({ data: jobs });
      logger.debug({ count: jobs.length }, 'Flushed access logs');
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to flush access log queue');
  } finally {
    isFlushing = false;
  }
};

export const startAccessLogWorker = (): void => {
  if (flushTimer) {
    return;
  }

  flushTimer = setInterval(() => {
    void flushAccessLogQueue();
  }, getSafeFlushIntervalMs());

  flushTimer.unref();
};

export const stopAccessLogWorker = async (): Promise<void> => {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = undefined;
  }

  await flushAccessLogQueue();
};
