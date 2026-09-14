import Redis from 'ioredis';
import { logger } from '../logger';

let redisClient: Redis | undefined;

const getRedisUrl = (): string | undefined => process.env.REDIS_URL;

const getRedisHost = (): string => process.env.REDIS_HOST || 'redis';

const getRedisPort = (): number => {
  const port = Number(process.env.REDIS_PORT ?? 6379);
  return Number.isInteger(port) && port > 0 ? port : 6379;
};

export const getRedisClient = (): Redis => {
  if (!redisClient) {
    const redisUrl = getRedisUrl();
    const redisOptions = {
      enableOfflineQueue: process.env.REDIS_ENABLE_OFFLINE_QUEUE !== 'false',
      maxRetriesPerRequest: 1,
    };

    redisClient = redisUrl
      ? new Redis(redisUrl, redisOptions)
      : new Redis({
          host: getRedisHost(),
          port: getRedisPort(),
          ...redisOptions,
        });

    redisClient.on('error', (error) => {
      logger.warn({ error }, 'Redis connection error');
    });
  }

  return redisClient;
};

export const disconnectRedis = async (): Promise<void> => {
  if (!redisClient) {
    return;
  }

  await redisClient.quit();
  redisClient = undefined;
};

/**
 * Acquire a distributed Redis lock using SET NX EX (atomic).
 * Returns true if lock was acquired, false if already held by another process.
 *
 * @param key   - Unique lock key (e.g. 'lock:payment:bill:42')
 * @param ttlMs - Lock time-to-live in milliseconds (auto-release on crash)
 */
export const acquireLock = async (key: string, ttlMs: number = 30_000): Promise<boolean> => {
  const result = await getRedisClient().set(key, '1', 'PX', ttlMs, 'NX');
  return result === 'OK';
};

/**
 * Release a distributed Redis lock.
 * Safe to call even if lock has already expired.
 *
 * @param key - Same key used in acquireLock
 */
export const releaseLock = async (key: string): Promise<void> => {
  await getRedisClient().del(key);
};
