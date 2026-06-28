import { RedisStore } from 'rate-limit-redis';
import type { RedisReply } from 'rate-limit-redis';
import { getRedisClient } from './redis';

export const createRateLimitStore = (prefix: string): RedisStore =>
  new RedisStore({
    prefix,
    sendCommand: async (...args: string[]) => {
      const [command, ...commandArgs] = args;
      return getRedisClient().call(command, ...commandArgs) as Promise<RedisReply>;
    },
  });
