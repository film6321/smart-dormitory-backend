"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteCacheByPattern = exports.setJsonCache = exports.getJsonCache = void 0;
const logger_1 = require("../logger");
const redis_1 = require("./redis");
const getJsonCache = async (key) => {
    try {
        const cached = await (0, redis_1.getRedisClient)().get(key);
        return cached ? JSON.parse(cached) : undefined;
    }
    catch (error) {
        logger_1.logger.warn({ error, key }, 'Failed to read cache');
        return undefined;
    }
};
exports.getJsonCache = getJsonCache;
const setJsonCache = async (key, value, ttlSeconds) => {
    try {
        await (0, redis_1.getRedisClient)().set(key, JSON.stringify(value), 'EX', ttlSeconds);
    }
    catch (error) {
        logger_1.logger.warn({ error, key }, 'Failed to write cache');
    }
};
exports.setJsonCache = setJsonCache;
const deleteCacheByPattern = async (pattern) => {
    try {
        const redis = (0, redis_1.getRedisClient)();
        let cursor = '0';
        do {
            const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = nextCursor;
            if (keys.length > 0) {
                await redis.del(...keys);
            }
        } while (cursor !== '0');
    }
    catch (error) {
        logger_1.logger.warn({ error, pattern }, 'Failed to delete cache by pattern');
    }
};
exports.deleteCacheByPattern = deleteCacheByPattern;
