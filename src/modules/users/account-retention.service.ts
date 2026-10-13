import { deleteCacheByPattern } from '../../shared/cache';
import { FaceCleanupService, type CleanupReceipt } from '../face-verification/face-cleanup.service';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Prisma, Role } from '@prisma/client';
import { prisma, type DbClient } from '../../database/db';
import { AppError } from '../../middlewares/error-handler';
import { logger } from '../../logger';

const pendingPayments = ['PENDING', 'VERIFYING', 'MANUAL_REVIEW'] as const;
const fileCategory = 'RETENTION_FILES';

export function inactivityCutoff(now: Date): Date {
  const year = now.getUTCFullYear() - 1;
  const day = Math.min(now.getUTCDate(), new Date(Date.UTC(year, now.getUTCMonth() + 1, 0)).getUTCDate());
  const result = new Date(now); result.setUTCFullYear(year, now.getUTCMonth(), day); return result;
}
export function inactiveForYear(user: { lastLogin: Date | null; createdAt: Date; role: string }, now: Date): boolean {
  return user.role !== 'ADMIN' && (user.lastLogin ?? user.createdAt) <= inactivityCutoff(now);
}

export class AccountRetentionService {
  static resolveFile(value: string): string {
    const roots = [path.resolve(process.env.UPLOAD_ROOT || 'uploads/private'), path.resolve('uploads/face-photo'), path.resolve('uploads')];
    const normalized = value.replace(/^uploads[\\/]private[\\/]/u, '');
    const target = /^uploads[\\/]private[\\/]/u.test(value)
      ? path.resolve(roots[0], normalized)
      : path.isAbsolute(value) || /^uploads[\\/]/u.test(value) ? path.resolve(value) : path.resolve(roots[0], normalized);
    if (!roots.some(root => target.startsWith(root + path.sep))) throw new AppError('ไฟล์อยู่นอกพื้นที่อัปโหลดที่อนุญาต', 409);
    return target;
  }
  private static async queueFiles(tx: Prisma.TransactionClient, values: Array<string | null | undefined>) {
    const keys: string[] = [];
    for (const value of new Set(values.filter((v): v is string => Boolean(v)))) {
      const target = this.resolveFile(value);
      const key = 'retention-file:' + createHash('sha256').update(target).digest('hex');
      await tx.systemSetting.upsert({ where: { key }, create: { key, category: fileCategory, value: target }, update: { value: target } });
      keys.push(key);
    }
    return keys;
  }
  static async purgeTenant(tx: Prisma.TransactionClient, tenantId: number) {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new AppError('ไม่พบผู้พัก', 404);
    if (!['INACTIVE', 'REJECTED', 'ARCHIVED'].includes(tenant.status) || tenant.roomId !== null) throw new AppError('ต้องบันทึกย้ายออกหรือปฏิเสธใบสมัครก่อนลบข้อมูล', 409);
    const userId = tenant.userId;
    const sharedBatch = await tx.paymentBatch.count({ where: { items: { some: { bill: { tenantId } } }, AND: { items: { some: { bill: { tenantId: { not: tenantId } } } } } } });
    if (sharedBatch) throw new AppError('มีบิลรวมร่วมกับผู้พักอื่น ต้องแยกจัดการก่อนลบข้อมูล', 409);
    // A QR-only placeholder is not an unsettled transfer once every owned bill
    // has been paid elsewhere. Purge it with the other batches in this transaction.
    // Any slip, provider result, foreign payer or unpaid bill retains the guard.
    const unusedPaidBatch: Prisma.PaymentBatchWhereInput = userId === null ? { id: -1 } : {
      payerUserId: userId, status: 'PENDING',
      slipHash: null, slipPath: null, slipAmount: null, transferAt: null,
      providerTransactionId: null, providerResponse: null, verifiedAt: null, failureReason: null,
      items: { some: {}, every: { bill: { tenantId, status: 'PAID' } } },
    };
    const batchPending = await tx.paymentBatch.count({ where: {
      items: { some: { bill: { tenantId } } }, status: { in: [...pendingPayments] }, NOT: unusedPaidBatch,
    } });
    const otherPayerBatch = await tx.paymentBatch.count({ where: { items: { some: { bill: { tenantId } } }, ...(userId === null ? { payerUserId: { not: null } } : { OR: [{ payerUserId: { not: userId } }, { payerUserId: null }] }) } });
    if (batchPending || otherPayerBatch) throw new AppError('มีบิลรวมค้างหรือชำระผ่านบัญชีอื่น ต้องแยกจัดการก่อนลบ', 409);
    const unpaid = await tx.bill.count({ where: { tenantId, status: { not: 'PAID' } } });
    const repairs = await tx.maintenanceTicket.count({ where: { tenantId, status: { notIn: ['CLOSED', 'CANCELLED'] } } });
    const pending = await tx.payment.count({ where: { OR: [{ housingTenantId: tenantId }, { bill: { tenantId } }], status: { in: [...pendingPayments] } } });
    if (unpaid || repairs || pending) throw new AppError('ยังมีบิล งานซ่อม หรือการชำระเงินค้าง ต้องจัดการให้เสร็จก่อนลบ', 409);
    const visitors = await tx.visitor.findMany({ where: { tenantId }, include: { faceEnrollmentPhotos: true } });
    if (visitors.some(v => ['REGISTERED', 'VERIFYING', 'APPROVED', 'CHECKED_IN'].includes(v.status))) throw new AppError('ยังมีผู้มาติดต่อที่ไม่สิ้นสุดรายการ', 409);
    const payments = await tx.payment.findMany({ where: { OR: [{ housingTenantId: tenantId }, { bill: { tenantId } }] } });
    const batches = await tx.paymentBatch.findMany({ where: { items: { some: { bill: { tenantId } } } } });
    const tickets = await tx.maintenanceTicket.findMany({ where: { tenantId }, select: { description: true } });
    const maintenanceRoot = path.resolve(process.env.UPLOAD_ROOT || 'uploads/maintenance');
    const maintenancePhotos = tickets.flatMap(ticket => {
      const filename = /^\[IMAGE:([^\]]+)\]/u.exec(ticket.description)?.[1];
      if (!filename) return [];
      if (filename === '.' || filename === '..' || /[\\/]/u.test(filename)) {
        throw new AppError('ภาพแนบงานซ่อมมีเส้นทางไม่ปลอดภัย ต้องตรวจสอบก่อนลบ', 409);
      }
      return [path.join(maintenanceRoot, filename)];
    });
    const cleanupTasks = await this.queueFiles(tx, [...maintenancePhotos, tenant.idCardImagePath, tenant.paymentSlipPath, ...payments.map(p => p.slipPath), ...batches.map(b => b.slipPath), ...visitors.map(v => v.idCardImagePath)]);
    for (const visitor of [...visitors].sort((a, b) => a.id - b.id)) cleanupTasks.push(await FaceCleanupService.enqueue(tx, { kind: 'visitor', id: visitor.id }));
    const visitorIds = visitors.map(v => v.id);
    await tx.visitorLog.deleteMany({ where: { visitorId: { in: visitorIds } } });
    await tx.visitor.deleteMany({ where: { id: { in: visitorIds } } });
    await tx.maintenanceTicket.deleteMany({ where: { tenantId } });
    await tx.notification.deleteMany({ where: { tenantId } });
    await tx.notificationPreference.deleteMany({ where: { tenantId } });
    await tx.payment.deleteMany({ where: { id: { in: payments.map(p => p.id) } } });
    await tx.paymentBatchItem.deleteMany({ where: { bill: { tenantId } } });
    await tx.paymentBatch.deleteMany({ where: { id: { in: batches.map(b => b.id) } } });
    await tx.bill.deleteMany({ where: { tenantId } });
    await tx.tenant.delete({ where: { id: tenantId } });
    return { userId, cleanupTasks };
  }
  static async deleteTenant(tenantId: number, db: DbClient = prisma) {
    const run = async (tx: Prisma.TransactionClient) => {
      const snapshot = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!snapshot) throw new AppError('ไม่พบผู้พัก', 404);
      if (snapshot.userId !== null) await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${snapshot.userId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
      const current = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!current || current.userId !== snapshot.userId) throw new AppError('ข้อมูลผู้พักถูกแก้ไขพร้อมกัน กรุณาลองใหม่', 409);
      if (snapshot.userId !== null) {
        const owner = await tx.user.findUnique({ where: { id: snapshot.userId } });
        if (owner?.role === Role.ADMIN) throw new AppError('ไม่สามารถลบข้อมูลบัญชีผู้ดูแลระบบผ่านรายการผู้พัก', 409);
      }
      const { userId, cleanupTasks } = await this.purgeTenant(tx, tenantId);
      if (userId !== null) cleanupTasks.push(...await this.purgeUserArtifacts(tx, userId));
      return cleanupTasks;
    };
    const keys = typeof db.$transaction === 'function'
      ? await (db as typeof prisma).$transaction(run, { timeout: 15000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      : await run(db);
    return this.finishCleanup(keys, db, tenantId);
  }
  private static async finishCleanup(keys: string[], db: DbClient, tenantId?: number): Promise<CleanupReceipt> {
    if (db !== prisma) return { status: keys.length ? 'PENDING' : 'COMPLETE', tasks: keys.map(taskKey => ({ taskKey, status: 'PENDING' })) };
    await deleteCacheByPattern('cache:ocr:id-card-verifications:*');
    // Do not make a committed deletion wait for many external owners or the file backlog.
    // The independently running cleanup worker owns retries and completion.
    try { return await FaceCleanupService.receipt(keys); }
    catch (error) {
      logger.error({ error, tenantId }, 'Cleanup status unavailable after committed deletion');
      return { status: 'PENDING', tasks: keys.map(taskKey => ({ taskKey, status: 'PENDING' })) };
    }
  }
  static async deleteUser(userId: number, db: DbClient = prisma): Promise<CleanupReceipt> {
    const run = async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId }, include: { tenant: true } });
      if (!user) throw new AppError('ไม่พบผู้ใช้', 404);
      if (user.role === Role.ADMIN) throw new AppError('ไม่อนุญาตลบบัญชีผู้ดูแลผ่าน flow นี้', 409);
      const tasks: string[] = [];
      if (user.tenant) tasks.push(...(await this.purgeTenant(tx, user.tenant.id)).cleanupTasks);
      tasks.push(...await this.purgeUserArtifacts(tx, userId));
      await tx.user.delete({ where: { id: userId } });
      return tasks;
    };
    const keys = typeof db.$transaction === 'function'
      ? await (db as typeof prisma).$transaction(run, { timeout: 15000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      : await run(db);
    return this.finishCleanup(keys, db);
  }
  private static async purgeUserArtifacts(tx: Prisma.TransactionClient, userId: number) {
    const sharedBatch = await tx.paymentBatch.count({ where: { payerUserId: userId, items: { some: {} } } });
    if (sharedBatch) throw new AppError('บัญชีมีบิลรวมที่ยังผูกกับข้อมูลผู้พัก ต้องแยกจัดการก่อนลบ', 409);
    if (await tx.payment.count({ where: { payerUserId: userId, billId: { not: null } } })) throw new AppError('มีรายการชำระที่ผูกบิลผู้พักอื่น ต้องแยกจัดการก่อนลบ', 409);
    const pending = await tx.payment.count({ where: { payerUserId: userId, status: { in: [...pendingPayments] } } });
    const batchesPending = await tx.paymentBatch.count({ where: { payerUserId: userId, status: { in: [...pendingPayments] } } });
    const jobsPending = await tx.ocrJob.count({ where: { userId, status: { in: ['PENDING', 'PROCESSING'] } } });
    if (pending || batchesPending || jobsPending) throw new AppError('ยังมีการชำระเงินหรือประมวลผลเอกสารค้าง', 409);
    const jobs = await tx.ocrJob.findMany({ where: { userId: userId } });
    const verifications = await tx.idCardVerification.findMany({ where: { userId: userId } });
    const payments = await tx.payment.findMany({ where: { payerUserId: userId } });
    const batches = await tx.paymentBatch.findMany({ where: { payerUserId: userId } });
    const staged = await tx.systemSetting.findMany?.({ where: { category: 'MAINTENANCE_UPLOAD', updatedById: userId } }) ?? [];
    const stagedFiles = staged.map(row => {
      const filename = row.key.slice('maintenance-upload:'.length);
      if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(filename)) throw new AppError('Invalid staged maintenance filename', 409);
      return path.join(path.resolve(process.env.UPLOAD_ROOT || 'uploads/maintenance'), filename);
    });
    const fileTasks = await this.queueFiles(tx, [...stagedFiles, ...jobs.map(j => j.imagePath), ...verifications.map(v => v.imagePath), ...payments.map(p => p.slipPath), ...batches.map(b => b.slipPath)]);
    await tx.payment.deleteMany({ where: { payerUserId: userId } });
    await tx.paymentBatch.deleteMany({ where: { payerUserId: userId } });
    await tx.transaction.deleteMany({ where: { userId } });
    await tx.housingApplicationDraft.deleteMany({ where: { userId } });
    await tx.ocrJob.deleteMany({ where: { userId: userId } });
    await tx.payment.updateMany({ where: { housingVerificationId: { in: verifications.map(v => v.id) } }, data: { housingVerificationId: null } });
    await tx.idCardVerification.deleteMany({ where: { userId: userId } });
    await tx.accessLog.deleteMany({ where: { userId: userId } });
    const faceTask = await FaceCleanupService.enqueue(tx, { kind: 'user', id: userId });
    await tx.notification.deleteMany({ where: { userId: userId } });
    await tx.notificationPreference.deleteMany({ where: { userId: userId } });
    if (staged.length) await tx.systemSetting.deleteMany({ where: { id: { in: staged.map(row => row.id) } } });
    await tx.systemSetting.updateMany({ where: { updatedById: userId }, data: { updatedById: null } });
    return [...fileTasks, faceTask];
  }
  static async process(now = new Date(), dryRun = true, db: typeof prisma = prisma) {
    const cutoff = inactivityCutoff(now);
    const users = await db.user.findMany({ where: { role: { not: Role.ADMIN }, OR: [{ lastLogin: { lte: cutoff } }, { lastLogin: null, createdAt: { lte: cutoff } }] }, select: { id: true }, orderBy: { id: 'asc' } });
    const result = { candidates: users.length, deleted: 0, eligible: 0, skipped: 0 };
    for (const candidate of users) {
      try {
        const eligible = await db.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${candidate.id} FOR UPDATE`;
          const user = await tx.user.findUnique({ where: { id: candidate.id }, include: { tenant: true } });
          if (!user || !inactiveForYear(user, now)) return false;
          if (user.tenant && (!['INACTIVE', 'REJECTED', 'ARCHIVED'].includes(user.tenant.status) || user.tenant.roomId !== null)) return false;
          const financialPending = await tx.payment.count({ where: { payerUserId: user.id, status: { in: [...pendingPayments] } } });
          const batchesPending = await tx.paymentBatch.count({ where: { payerUserId: user.id, status: { in: [...pendingPayments] } } });
          const jobsPending = await tx.ocrJob.count({ where: { userId: user.id, status: { in: ['PENDING', 'PROCESSING'] } } });
          if (financialPending || batchesPending || jobsPending) return false;
          if (user.tenant) {
            const unsettled = await tx.bill.count({ where: { tenantId: user.tenant.id, status: { not: 'PAID' } } });
            const repairs = await tx.maintenanceTicket.count({ where: { tenantId: user.tenant.id, status: { notIn: ['CLOSED', 'CANCELLED'] } } });
            const visitors = await tx.visitor.count({ where: { tenantId: user.tenant.id, status: { in: ['REGISTERED', 'VERIFYING', 'APPROVED', 'CHECKED_IN'] } } });
            const tenantPayments = await tx.payment.count({ where: { OR: [{ housingTenantId: user.tenant.id }, { bill: { tenantId: user.tenant.id } }], status: { in: [...pendingPayments] } } });
            if (unsettled || repairs || visitors || tenantPayments) return false;
          }
          const sharedBatch = await tx.paymentBatch.count({ where: { payerUserId: user.id, items: { some: { bill: { ...(user.tenant ? { tenantId: { not: user.tenant.id } } : {}) } } } } });
          if (sharedBatch) return false;
          const otherBillPayment = await tx.payment.count({ where: { payerUserId: user.id, billId: { not: null }, ...(user.tenant ? { bill: { tenantId: { not: user.tenant.id } } } : {}) } });
          if (otherBillPayment) return false;
          if (user.tenant) {
            const tenantSharedBatch = await tx.paymentBatch.count({ where: { items: { some: { bill: { tenantId: user.tenant.id } } }, AND: { items: { some: { bill: { tenantId: { not: user.tenant.id } } } } } } });
            if (tenantSharedBatch) return false;
            const tenantBatchPending = await tx.paymentBatch.count({ where: { items: { some: { bill: { tenantId: user.tenant.id } } }, OR: [{ status: { in: [...pendingPayments] } }, { payerUserId: { not: user.id } }, { payerUserId: null }] } });
            if (tenantBatchPending) return false;
          }
          if (dryRun) return true;
          if (user.tenant) await this.purgeTenant(tx, user.tenant.id);
          await this.purgeUserArtifacts(tx, user.id);
          await tx.user.delete({ where: { id: user.id } });
          return true;
        }, { timeout: 15000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        if (eligible) { result.eligible++; if (!dryRun) result.deleted++; } else result.skipped++;
      } catch (error) { result.skipped++; logger.warn({ error, userId: candidate.id }, 'Account retention skipped account'); }
    }
    if (!dryRun && db === prisma) { await FaceCleanupService.processAll(); await this.flushFiles(); }
    return result;
  }
  static async flushFiles(db: typeof prisma = prisma) {
    const entries = await db.systemSetting.findMany({ where: { category: fileCategory }, orderBy: { id: 'asc' } });
    for (const entry of entries) {
      try {
        const target = this.resolveFile(entry.value);
        const privateRoot = path.resolve(process.env.UPLOAD_ROOT || 'uploads/private');
        const variants = new Set([target, path.relative(process.cwd(), target), path.relative(privateRoot, target)]);
        for (const value of [...variants]) variants.add(value.replace(/\\/gu, '/'));
        const paths = [...variants];
        const references = await Promise.all([
          db.tenant.count({ where: { OR: [{ idCardImagePath: { in: paths } }, { paymentSlipPath: { in: paths } }] } }),
          db.payment.count({ where: { slipPath: { in: paths } } }),
          db.paymentBatch.count({ where: { slipPath: { in: paths } } }),
          db.idCardVerification.count({ where: { imagePath: { in: paths } } }),
          db.ocrJob.count({ where: { imagePath: { in: paths } } }),
          db.visitor.count({ where: { idCardImagePath: { in: paths } } }),
          db.faceEnrollmentPhoto.count({ where: { photoPath: { in: paths } } }),
          db.maintenanceTicket.count({ where: { description: { startsWith: `[IMAGE:${path.basename(target)}]` } } }),
        ]);
        if (references.some(count => count > 0)) continue;
        // Resolve symlinks too; never remove a file outside the actual upload roots.
        try {
          const actual = await fs.realpath(target); this.resolveFile(actual);
          const stat = await fs.lstat(target); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe upload path');
          await fs.unlink(target);
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        await db.systemSetting.delete({ where: { id: entry.id } });
      } catch (error) { logger.error({ error, retentionKey: entry.key }, 'Retention file cleanup pending retry'); }
    }
  }
}
