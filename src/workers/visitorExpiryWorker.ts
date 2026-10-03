import { logger } from '../logger';
import { VisitorService } from '../modules/visitor/visitor.service';

let workerTimer: NodeJS.Timeout | undefined;
let isProcessing = false;

export async function processVisitorExpiry(now = new Date()) {
  if (isProcessing) return 0;
  isProcessing = true;
  try {
    return await VisitorService.expirePendingVisitors(now);
  } catch (error) {
    logger.error({ error }, 'Visitor expiry worker failed');
    return 0;
  } finally {
    isProcessing = false;
  }
}

export function startVisitorExpiryWorker(intervalMs = Number(process.env.VISITOR_EXPIRY_WORKER_INTERVAL_MS ?? 60_000)) {
  if (workerTimer) return workerTimer;
  const safeInterval = Number.isInteger(intervalMs) && intervalMs > 0 ? intervalMs : 60_000;
  void processVisitorExpiry();
  workerTimer = setInterval(() => void processVisitorExpiry(), safeInterval);
  workerTimer.unref();
  logger.info({ intervalMs: safeInterval }, 'Visitor expiry worker started');
  return workerTimer;
}

export function stopVisitorExpiryWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = undefined;
  }
}
