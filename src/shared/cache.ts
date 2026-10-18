import { logger } from '../logger';
import { getRedisClient } from './redis';

export const getJsonCache = async <T>(key: string, decode: (value: unknown) => T | undefined): Promise<T | undefined> => {
  try {
    const cached = await getRedisClient().get(key);
    if (!cached) return undefined;
    const value: unknown = JSON.parse(cached);
    return decode(value);
  } catch (error) {
    logger.warn({ error, key }, 'Failed to read cache');
    return undefined;
  }
};

export const setJsonCache = async (key: string, value: unknown, ttlSeconds: number): Promise<void> => {
  try {
    await getRedisClient().set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (error) {
    logger.warn({ error, key }, 'Failed to write cache');
  }
};

export const deleteCacheByPattern = async (pattern: string): Promise<void> => {
  try {
    const redis = getRedisClient();
    let cursor = '0';

    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;

      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== '0');
  } catch (error) {
    logger.warn({ error, pattern }, 'Failed to delete cache by pattern');
  }
};
