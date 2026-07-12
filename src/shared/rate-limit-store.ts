import { MemoryStore } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { RedisReply } from 'rate-limit-redis';
import { logger } from '../logger';
import { getRedisClient } from './redis';

const useRedisRateLimitStore = (): boolean =>
  process.env.NODE_ENV !== 'test' && process.env.DISABLE_REDIS_RATE_LIMITS !== 'true';

export const createRateLimitStore = (prefix: string) => {
  if (!useRedisRateLimitStore()) {
    logger.info({ prefix }, 'Using in-memory rate limit store for tests or disabled Redis rate limiting');
    return new MemoryStore();
  }

  try {
    return new RedisStore({
      prefix,
      sendCommand: async (...args: string[]) => {
        const [command, ...commandArgs] = args;
        return getRedisClient().call(command, ...commandArgs) as Promise<RedisReply>;
      },
    });
  } catch (error) {
    logger.warn({ error, prefix }, 'Failed to initialize Redis rate limit store, falling back to in-memory store');
    return new MemoryStore();
  }
};
