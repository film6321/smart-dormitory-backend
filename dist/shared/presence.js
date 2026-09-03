"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveUsersPresence = exports.clearUserOnline = exports.markUserOnline = void 0;
const logger_1 = require("../logger");
const redis_1 = require("./redis");
const onlineTtlSeconds = Number(process.env.USER_ONLINE_TTL_SECONDS ?? 90);
const presenceKey = (userId) => `presence:user:${userId}`;
const normalizeTimestamp = (value) => {
    if (!value) {
        return undefined;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};
const markUserOnline = async (userId, lastSeenAt = new Date()) => {
    try {
        await (0, redis_1.getRedisClient)().set(presenceKey(userId), lastSeenAt.toISOString(), 'EX', onlineTtlSeconds);
    }
    catch (error) {
        logger_1.logger.warn({ error, userId }, 'Failed to mark user online');
    }
};
exports.markUserOnline = markUserOnline;
const clearUserOnline = async (userId) => {
    try {
        await (0, redis_1.getRedisClient)().del(presenceKey(userId));
    }
    catch (error) {
        logger_1.logger.warn({ error, userId }, 'Failed to clear user presence');
    }
};
exports.clearUserOnline = clearUserOnline;
const resolveUsersPresence = async (users) => {
    if (users.length === 0) {
        return {};
    }
    try {
        const redis = (0, redis_1.getRedisClient)();
        const keys = users.map((user) => presenceKey(user.id));
        const values = await redis.mget(...keys);
        return users.reduce((acc, user, index) => {
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
    }
    catch (error) {
        logger_1.logger.warn({ error }, 'Failed to resolve user presence');
        return users.reduce((acc, user) => {
            acc[user.id] = {
                isOnline: true,
                lastSeenAt: normalizeTimestamp(user.lastLogin),
            };
            return acc;
        }, {});
    }
};
exports.resolveUsersPresence = resolveUsersPresence;
