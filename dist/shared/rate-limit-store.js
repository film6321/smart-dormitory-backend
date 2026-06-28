"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRateLimitStore = void 0;
const rate_limit_redis_1 = require("rate-limit-redis");
const redis_1 = require("./redis");
const createRateLimitStore = (prefix) => new rate_limit_redis_1.RedisStore({
    prefix,
    sendCommand: async (...args) => {
        const [command, ...commandArgs] = args;
        return (0, redis_1.getRedisClient)().call(command, ...commandArgs);
    },
});
exports.createRateLimitStore = createRateLimitStore;
