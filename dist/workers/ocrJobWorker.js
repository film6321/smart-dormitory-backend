"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopOcrJobWorker = exports.startOcrJobWorker = exports.processOcrJobQueue = void 0;
const logger_1 = require("../logger");
const ocr_queue_1 = require("../modules/ocr/ocr.queue");
const ocr_service_1 = require("../modules/ocr/ocr.service");
const ocrJobWorkerIntervalMs = Number(process.env.OCR_JOB_WORKER_INTERVAL_MS ?? 1000);
const ocrJobWorkerBatchSize = Number(process.env.OCR_JOB_WORKER_BATCH_SIZE ?? 5);
let workerTimer;
let isProcessing = false;
const getSafeIntervalMs = () => {
    if (!Number.isInteger(ocrJobWorkerIntervalMs) || ocrJobWorkerIntervalMs < 250) {
        return 1000;
    }
    return ocrJobWorkerIntervalMs;
};
const getSafeBatchSize = () => {
    if (!Number.isInteger(ocrJobWorkerBatchSize) || ocrJobWorkerBatchSize < 1) {
        return 5;
    }
    return Math.min(ocrJobWorkerBatchSize, 25);
};
const processOcrJobQueue = async () => {
    if (isProcessing) {
        return;
    }
    isProcessing = true;
    try {
        for (let index = 0; index < getSafeBatchSize(); index += 1) {
            const jobId = await (0, ocr_queue_1.dequeueOcrJob)();
            if (!jobId) {
                break;
            }
            await ocr_service_1.OcrService.processIdCardVerificationJob(jobId);
        }
    }
    catch (error) {
        logger_1.logger.warn({ error }, 'Failed to process OCR job queue');
    }
    finally {
        isProcessing = false;
    }
};
exports.processOcrJobQueue = processOcrJobQueue;
const startOcrJobWorker = () => {
    if (workerTimer) {
        return;
    }
    workerTimer = setInterval(() => {
        void (0, exports.processOcrJobQueue)();
    }, getSafeIntervalMs());
    workerTimer.unref();
};
exports.startOcrJobWorker = startOcrJobWorker;
const stopOcrJobWorker = async () => {
    if (workerTimer) {
        clearInterval(workerTimer);
        workerTimer = undefined;
    }
    await (0, exports.processOcrJobQueue)();
};
exports.stopOcrJobWorker = stopOcrJobWorker;
