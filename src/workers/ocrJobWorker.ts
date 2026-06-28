import { logger } from '../logger';
import { dequeueOcrJob } from '../modules/ocr/ocr.queue';
import { OcrService } from '../modules/ocr/ocr.service';

const ocrJobWorkerIntervalMs = Number(process.env.OCR_JOB_WORKER_INTERVAL_MS ?? 1000);
const ocrJobWorkerBatchSize = Number(process.env.OCR_JOB_WORKER_BATCH_SIZE ?? 5);

let workerTimer: NodeJS.Timeout | undefined;
let isProcessing = false;

const getSafeIntervalMs = (): number => {
  if (!Number.isInteger(ocrJobWorkerIntervalMs) || ocrJobWorkerIntervalMs < 250) {
    return 1000;
  }

  return ocrJobWorkerIntervalMs;
};

const getSafeBatchSize = (): number => {
  if (!Number.isInteger(ocrJobWorkerBatchSize) || ocrJobWorkerBatchSize < 1) {
    return 5;
  }

  return Math.min(ocrJobWorkerBatchSize, 25);
};

export const processOcrJobQueue = async (): Promise<void> => {
  if (isProcessing) {
    return;
  }

  isProcessing = true;

  try {
    for (let index = 0; index < getSafeBatchSize(); index += 1) {
      const jobId = await dequeueOcrJob();

      if (!jobId) {
        break;
      }

      await OcrService.processIdCardVerificationJob(jobId);
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to process OCR job queue');
  } finally {
    isProcessing = false;
  }
};

export const startOcrJobWorker = (): void => {
  if (workerTimer) {
    return;
  }

  workerTimer = setInterval(() => {
    void processOcrJobQueue();
  }, getSafeIntervalMs());

  workerTimer.unref();
};

export const stopOcrJobWorker = async (): Promise<void> => {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = undefined;
  }

  await processOcrJobQueue();
};
