import { MaintenanceService } from '../modules/maintenance/maintenance.service';
import { FaceCleanupService } from '../modules/face-verification/face-cleanup.service';
import { AccountRetentionService } from '../modules/users/account-retention.service';
import { logger } from '../logger';
let timer: NodeJS.Timeout | undefined;
let running: Promise<unknown> | undefined;
let cleanupTimer: NodeJS.Timeout | undefined;
let cleanupRunning: Promise<unknown> | undefined;
export function processPendingCleanup() {
  if (cleanupRunning) return cleanupRunning;
  cleanupRunning = FaceCleanupService.processAll().then(() => AccountRetentionService.flushFiles()).then(() => MaintenanceService.cleanupExpiredUploads())
    .catch(error => logger.error({ error }, 'Pending cleanup failed'))
    .finally(() => { cleanupRunning = undefined; });
  return cleanupRunning;
}
export function processAccountRetention() {
  if (running) return running;
  running = AccountRetentionService.process(new Date(), process.env.ACCOUNT_RETENTION_MODE !== 'delete')
    .then(result => logger.info({ ...result, mode: process.env.ACCOUNT_RETENTION_MODE || 'dry-run' }, 'Account retention completed'))
    .catch(error => logger.error({ error }, 'Account retention failed'))
    .finally(() => { running = undefined; });
  return running;
}
export function startAccountRetentionWorker() {
  if (!cleanupTimer) {
    // Retry only deletions already authorized and committed, independently of inactivity purging.
    cleanupTimer = setInterval(() => void processPendingCleanup(), 60000); cleanupTimer.unref();
  }
  if (timer) return;
  // Opt-in only after migration/review; no startup deletion during development.
  if (!['dry-run', 'delete'].includes(process.env.ACCOUNT_RETENTION_MODE || '')) return;
  void processAccountRetention();
  timer = setInterval(() => void processAccountRetention(), 24 * 60 * 60 * 1000); timer.unref();
}
export async function stopAccountRetentionWorker() { if (timer) clearInterval(timer); timer = undefined; if (cleanupTimer) clearInterval(cleanupTimer); cleanupTimer = undefined; await Promise.all([running, cleanupRunning]); }
