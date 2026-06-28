"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dequeueOcrJob = exports.enqueueOcrJob = exports.ocrJobQueueKey = void 0;
const redis_1 = require("../../shared/redis");
exports.ocrJobQueueKey = process.env.OCR_JOB_QUEUE_KEY || 'dormitory:ocr-jobs';
const enqueueOcrJob = async (jobId) => {
    await (0, redis_1.getRedisClient)().rpush(exports.ocrJobQueueKey, jobId);
};
exports.enqueueOcrJob = enqueueOcrJob;
const dequeueOcrJob = async () => (0, redis_1.getRedisClient)().lpop(exports.ocrJobQueueKey);
exports.dequeueOcrJob = dequeueOcrJob;
