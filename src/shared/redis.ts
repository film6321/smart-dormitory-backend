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
    redisClient = redisUrl
      ? new Redis(redisUrl, {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        })
      : new Redis({
          host: getRedisHost(),
          port: getRedisPort(),
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
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
