"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRateLimitStore = void 0;
const express_rate_limit_1 = require("express-rate-limit");
const rate_limit_redis_1 = require("rate-limit-redis");
const logger_1 = require("../logger");
const redis_1 = require("./redis");
const useRedisRateLimitStore = () => process.env.NODE_ENV !== 'test' && process.env.DISABLE_REDIS_RATE_LIMITS !== 'true';
const createRateLimitStore = (prefix) => {
    if (!useRedisRateLimitStore()) {
        logger_1.logger.info({ prefix }, 'Using in-memory rate limit store for tests or disabled Redis rate limiting');
        return new express_rate_limit_1.MemoryStore();
    }
    try {
        return new rate_limit_redis_1.RedisStore({
            prefix,
            sendCommand: async (...args) => {
                const [command, ...commandArgs] = args;
                return (0, redis_1.getRedisClient)().call(command, ...commandArgs);
            },
        });
    }
    catch (error) {
        logger_1.logger.warn({ error, prefix }, 'Failed to initialize Redis rate limit store, falling back to in-memory store');
        return new express_rate_limit_1.MemoryStore();
    }
};
exports.createRateLimitStore = createRateLimitStore;
