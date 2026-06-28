import { getRedisClient } from '../../shared/redis';

export const ocrJobQueueKey = process.env.OCR_JOB_QUEUE_KEY || 'dormitory:ocr-jobs';

export const enqueueOcrJob = async (jobId: string): Promise<void> => {
  await getRedisClient().rpush(ocrJobQueueKey, jobId);
};

export const dequeueOcrJob = async (): Promise<string | null> => getRedisClient().lpop(ocrJobQueueKey);
