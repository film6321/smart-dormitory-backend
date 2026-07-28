"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.disconnectRedis = exports.getRedisClient = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const logger_1 = require("../logger");
let redisClient;
const getRedisUrl = () => process.env.REDIS_URL;
const getRedisHost = () => process.env.REDIS_HOST || 'redis';
const getRedisPort = () => {
    const port = Number(process.env.REDIS_PORT ?? 6379);
    return Number.isInteger(port) && port > 0 ? port : 6379;
};
const getRedisClient = () => {
    if (!redisClient) {
        const redisUrl = getRedisUrl();
        const redisOptions = {
            enableOfflineQueue: process.env.REDIS_ENABLE_OFFLINE_QUEUE !== 'false',
            maxRetriesPerRequest: 1,
        };
        redisClient = redisUrl
            ? new ioredis_1.default(redisUrl, redisOptions)
            : new ioredis_1.default({
                host: getRedisHost(),
                port: getRedisPort(),
                ...redisOptions,
            });
        redisClient.on('error', (error) => {
            logger_1.logger.warn({ error }, 'Redis connection error');
        });
    }
    return redisClient;
};
exports.getRedisClient = getRedisClient;
const disconnectRedis = async () => {
    if (!redisClient) {
        return;
    }
    await redisClient.quit();
    redisClient = undefined;
};
exports.disconnectRedis = disconnectRedis;
