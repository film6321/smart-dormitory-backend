"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopAccessLogWorker = exports.startAccessLogWorker = exports.flushAccessLogQueue = exports.enqueueAccessLog = void 0;
const db_1 = require("../database/db");
const logger_1 = require("../logger");
const redis_1 = require("../shared/redis");
const accessLogQueueKey = process.env.ACCESS_LOG_QUEUE_KEY || 'dormitory:access-logs';
const accessLogBatchSize = Number(process.env.ACCESS_LOG_BATCH_SIZE ?? 100);
const accessLogFlushIntervalMs = Number(process.env.ACCESS_LOG_FLUSH_INTERVAL_MS ?? 1000);
let flushTimer;
let isFlushing = false;
const getSafeBatchSize = () => {
    if (!Number.isInteger(accessLogBatchSize) || accessLogBatchSize < 1) {
        return 100;
    }
    return Math.min(accessLogBatchSize, 1000);
};
const getSafeFlushIntervalMs = () => {
    if (!Number.isInteger(accessLogFlushIntervalMs) || accessLogFlushIntervalMs < 250) {
        return 1000;
    }
    return accessLogFlushIntervalMs;
};
const enqueueAccessLog = async (job) => {
    await (0, redis_1.getRedisClient)().rpush(accessLogQueueKey, JSON.stringify(job));
};
exports.enqueueAccessLog = enqueueAccessLog;
const toAccessLogInput = (job) => ({
    method: job.method,
    path: job.path,
    ip: job.ip,
    userId: job.userId,
    duration: job.duration,
    createdAt: new Date(job.createdAt),
});
const flushAccessLogQueue = async () => {
    if (isFlushing) {
        return;
    }
    isFlushing = true;
    try {
        const redis = (0, redis_1.getRedisClient)();
        const batchSize = getSafeBatchSize();
        const jobs = [];
        for (let index = 0; index < batchSize; index += 1) {
            const rawJob = await redis.lpop(accessLogQueueKey);
            if (!rawJob) {
                break;
            }
            try {
                jobs.push(toAccessLogInput(JSON.parse(rawJob)));
            }
            catch (error) {
                logger_1.logger.warn({ error }, 'Dropped malformed access log job');
            }
        }
        if (jobs.length > 0) {
            await db_1.prisma.accessLog.createMany({ data: jobs });
            logger_1.logger.debug({ count: jobs.length }, 'Flushed access logs');
        }
    }
    catch (error) {
        logger_1.logger.warn({ error }, 'Failed to flush access log queue');
    }
    finally {
        isFlushing = false;
    }
};
exports.flushAccessLogQueue = flushAccessLogQueue;
const startAccessLogWorker = () => {
    if (flushTimer) {
        return;
    }
    flushTimer = setInterval(() => {
        void (0, exports.flushAccessLogQueue)();
    }, getSafeFlushIntervalMs());
    flushTimer.unref();
};
exports.startAccessLogWorker = startAccessLogWorker;
const stopAccessLogWorker = async () => {
    if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = undefined;
    }
    await (0, exports.flushAccessLogQueue)();
};
exports.stopAccessLogWorker = stopAccessLogWorker;
