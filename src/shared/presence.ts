import { logger } from '../logger';
import { getRedisClient } from './redis';

const onlineTtlSeconds = Number(process.env.USER_ONLINE_TTL_SECONDS ?? 90);
const presenceKey = (userId: number) => `presence:user:${userId}`;

export interface PresenceState {
  isOnline: boolean;
  lastSeenAt?: string;
}

const normalizeTimestamp = (value: unknown): string | undefined => {
  if (!value) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

export const markUserOnline = async (userId: number, lastSeenAt: Date = new Date()): Promise<void> => {
  try {
    await getRedisClient().set(presenceKey(userId), lastSeenAt.toISOString(), 'EX', onlineTtlSeconds);
  } catch (error) {
    logger.warn({ error, userId }, 'Failed to mark user online');
  }
};

export const clearUserOnline = async (userId: number): Promise<void> => {
  try {
    await getRedisClient().del(presenceKey(userId));
  } catch (error) {
    logger.warn({ error, userId }, 'Failed to clear user presence');
  }
};

export const resolveUsersPresence = async (
  users: Array<{ id: number; lastLogin?: Date | string | null }>,
): Promise<Record<number, PresenceState>> => {
  if (users.length === 0) {
    return {};
  }

  try {
    const redis = getRedisClient();
    const keys = users.map((user) => presenceKey(user.id));
    const values = await redis.mget(...keys);

    return users.reduce<Record<number, PresenceState>>((acc, user, index) => {
      const cached = values[index];
      if (cached) {
        acc[user.id] = { isOnline: true, lastSeenAt: normalizeTimestamp(cached) };
        return acc;
      }

      const lastSeenAt = normalizeTimestamp(user.lastLogin);
      acc[user.id] = {
        isOnline: lastSeenAt ? false : true,
        lastSeenAt,
      };
      return acc;
    }, {});
  } catch (error) {
    logger.warn({ error }, 'Failed to resolve user presence');

    return users.reduce<Record<number, PresenceState>>((acc, user) => {
      acc[user.id] = {
        isOnline: true,
        lastSeenAt: normalizeTimestamp(user.lastLogin),
      };
      return acc;
    }, {});
  }
};

export const listOnlineUserIds = async (): Promise<number[]> => {
  try {
    const redis = getRedisClient();
    const onlineUserIds: number[] = [];
    let cursor = '0';

    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'presence:user:*', 'COUNT', 100);
      cursor = nextCursor;

      for (const key of keys) {
        const match = key.match(/^presence:user:(\d+)$/);
        if (match) {
          onlineUserIds.push(Number(match[1]));
        }
      }
    } while (cursor !== '0');

    return onlineUserIds;
  } catch (error) {
    logger.warn({ error }, 'Failed to list online user IDs from Redis');
    return [];
  }
};
