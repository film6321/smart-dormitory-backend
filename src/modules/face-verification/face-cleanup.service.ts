import fs from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from '../../database/db';
import { AppError } from '../../middlewares/error-handler';
import { logger } from '../../logger';

export const FACE_CLEANUP_CATEGORY = 'FACE_CLEANUP';
type Owner = { kind: 'user' | 'visitor'; id: number };
type Job = Owner & { phase: 'EXTERNAL' | 'FILES' | 'DONE'; paths: string[]; templateIds: number[] };
export interface CleanupTask { taskKey: string; status: 'PENDING' | 'COMPLETE'; }
export interface CleanupReceipt { status: 'PENDING' | 'COMPLETE'; tasks: CleanupTask[]; }

export function faceApiVerifyUrl(): string {
  const base = (process.env.FACE_API_URL?.trim() || 'http://127.0.0.1:8000').replace(/\/+$/u, '');
  if (base.endsWith('/api/v1/faces/verify') || base.endsWith('/faces/verify')) return base;
  if (base.endsWith('/api/v1')) return `${base}/faces/verify`;
  return `${base}/api/v1/faces/verify`;
}

export class FaceCleanupService {
  private static parse(value: string): Job {
    const job = JSON.parse(value) as Job;
    if (!['user', 'visitor'].includes(job.kind) || !Number.isSafeInteger(job.id) || job.id <= 0 || !Number.isSafeInteger(job.id + 1000000) || job.kind === 'user' && job.id >= 1000000 || !['EXTERNAL', 'FILES', 'DONE'].includes(job.phase) || !Array.isArray(job.paths) || job.paths.some(p => typeof p !== 'string') || !Array.isArray(job.templateIds) || job.templateIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new AppError('Invalid face cleanup job', 409);
    return job;
  }
  static async enqueue(tx: Prisma.TransactionClient, owner: Owner): Promise<string> {
    if (!Number.isSafeInteger(owner.id) || owner.id <= 0 || !Number.isSafeInteger(owner.id + 1000000) || owner.kind === 'user' && owner.id >= 1000000) throw new AppError('Invalid face owner', 400);
    if (owner.kind === 'user') await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${owner.id} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "Visitor" WHERE id = ${owner.id} FOR UPDATE`;
    const where = owner.kind === 'user' ? { userId: owner.id } : { visitorId: owner.id };
    const taskKey = `face-cleanup:${owner.kind}:${owner.id}`;
    const photos = await tx.faceEnrollmentPhoto.findMany({ where });
    const existing = await tx.systemSetting.findUnique({ where: { key: taskKey } });
    const prior = existing ? this.parse(existing.value) : null;
    if (existing && (existing.category !== FACE_CLEANUP_CATEGORY || prior?.kind !== owner.kind || prior?.id !== owner.id)) throw new AppError('Cleanup owner mismatch', 409);
    const paths = [...new Set([...(prior?.paths || []), ...photos.map(photo => photo.photoPath)])];
    const templateIds = [...new Set([...(prior?.templateIds || []), ...photos.map(photo => photo.id)])];
    const job: Job = { ...owner, phase: prior && photos.length === 0 ? prior.phase : 'EXTERNAL', paths, templateIds };
    await tx.systemSetting.upsert({ where: { key: taskKey }, create: { key: taskKey, category: FACE_CLEANUP_CATEGORY, value: JSON.stringify(job) }, update: { category: FACE_CLEANUP_CATEGORY, value: JSON.stringify(job) } });
    if (owner.kind === 'user') await tx.user.update({ where: { id: owner.id }, data: { faceRevokedAt: new Date() } });
    else await tx.visitor.update({ where: { id: owner.id }, data: { faceRevokedAt: new Date() } });
    // The durable job keeps owner IDs and file paths even after cascades remove the profile.
    await tx.faceEmbedding.deleteMany({ where });
    await tx.faceEnrollmentPhoto.deleteMany({ where });
    return taskKey;
  }
  static async restoreForApprovedApplication(tx: Prisma.TransactionClient, userId: number) {
    const owner = await tx.user.findUnique({ where: { id: userId }, select: { faceRevokedAt: true } });
    if (!owner?.faceRevokedAt) return;
    const row = await tx.systemSetting.findUnique({ where: { key: `face-cleanup:user:${userId}` } });
    const job = row?.category === FACE_CLEANUP_CATEGORY ? this.parse(row.value) : null;
    if (!job || job.kind !== 'user' || job.id !== userId || job.phase !== 'DONE'
      || await tx.faceEnrollmentPhoto.count({ where: { userId } }) !== 0
      || await tx.faceEmbedding.count({ where: { userId } }) !== 0) {
      throw new AppError('ข้อมูลใบหน้าเดิมยังล้างไม่เสร็จ กรุณารอให้ล้างสำเร็จก่อนอนุมัติใบสมัครใหม่', 409);
    }
    await tx.user.update({ where: { id: userId }, data: { faceRevokedAt: null } });
    logger.info({ userId }, 'Face enrollment restored after clean new application approval');
  }

  static async status(taskKey: string, db: typeof prisma = prisma): Promise<CleanupTask> {
    if (/^retention-file:[a-f0-9]{64}$/u.test(taskKey)) {
      const file = await db.systemSetting.findUnique({ where: { key: taskKey } });
      if (file && file.category !== 'RETENTION_FILES') throw new AppError('Invalid cleanup task', 409);
      return { taskKey, status: file ? 'PENDING' : 'COMPLETE' };
    }
    if (!/^face-cleanup:(user|visitor):[1-9]\d*$/u.test(taskKey)) throw new AppError('Invalid cleanup task', 400);
    const row = await db.systemSetting.findUnique({ where: { key: taskKey } });
    if (!row || row.category !== FACE_CLEANUP_CATEGORY) throw new AppError('Cleanup task not found', 404);
    const job = this.parse(row.value);
    if (taskKey !== `face-cleanup:${job.kind}:${job.id}`) throw new AppError('Cleanup owner mismatch', 409);
    return { taskKey, status: job.phase === 'DONE' ? 'COMPLETE' : 'PENDING' };
  }
  static async pending(db: typeof prisma = prisma): Promise<CleanupTask[]> {
    const rows = await db.systemSetting.findMany({ where: { category: { in: [FACE_CLEANUP_CATEGORY, 'RETENTION_FILES'] } }, orderBy: { id: 'asc' } });
    const tasks: CleanupTask[] = [];
    for (const row of rows) {
      if (row.category === 'RETENTION_FILES' || this.parse(row.value).phase !== 'DONE') tasks.push(await this.status(row.key, db));
    }
    return tasks;
  }
  static async receipt(taskKeys: string[], db: typeof prisma = prisma): Promise<CleanupReceipt> {
    const tasks = await Promise.all([...new Set(taskKeys)].map(key => this.status(key, db)));
    return { status: tasks.every(task => task.status === 'COMPLETE') ? 'COMPLETE' : 'PENDING', tasks };
  }
  static async findByTemplate(templateId: number, db: typeof prisma = prisma): Promise<string | null> {
    const rows = await db.systemSetting.findMany({ where: { category: FACE_CLEANUP_CATEGORY } });
    for (const row of rows) if (this.parse(row.value).templateIds.includes(templateId)) return row.key;
    return null;
  }
  private static resolvePhoto(value: string): string {
    const root = path.resolve('uploads/face-photo');
    const target = path.resolve(value);
    if (!target.startsWith(root + path.sep)) throw new AppError('Invalid face photo path', 409);
    return target;
  }
  static async process(taskKey: string, db: typeof prisma = prisma): Promise<CleanupTask> {
    const row = await db.systemSetting.findUnique({ where: { key: taskKey } });
    if (!row || row.category !== FACE_CLEANUP_CATEGORY) throw new AppError('Cleanup task not found', 404);
    let job = this.parse(row.value);
    if (taskKey !== `face-cleanup:${job.kind}:${job.id}`) throw new AppError('Cleanup owner mismatch', 409);
    let snapshot = row.value;
    try {
      if (job.phase === 'EXTERNAL') {
        const apiKey = process.env.FACE_API_KEY?.trim();
        if (!apiKey) throw new AppError('FACE_API_KEY is not configured', 503);
        const ownerId = job.kind === 'user' ? job.id : job.id + 1000000;
        const response = await fetch(faceApiVerifyUrl().replace(/\/verify$/u, `/owners/${ownerId}`), { method: 'DELETE', headers: { 'X-API-Key': apiKey }, signal: AbortSignal.timeout(5000) });
        if (!response.ok || (await response.json() as { success?: boolean }).success !== true) throw new AppError('External face deletion not confirmed', 502);
        job = { ...job, phase: 'FILES' };
        const value = JSON.stringify(job);
        // Compare-and-set prevents stale processors from overwriting a newer job or DONE.
        const claim = await db.systemSetting.updateMany({ where: { id: row.id, value: snapshot }, data: { value } });
        if (claim.count !== 1) return this.status(taskKey, db);
        snapshot = value;
      }
      if (job.phase === 'FILES') {
        for (const photoPath of job.paths) {
          const target = this.resolvePhoto(photoPath);
          const aliases = [...new Set([photoPath, target, path.relative(process.cwd(), target), path.relative(process.cwd(), target).replace(/\\/gu, '/')])];
          const references = await Promise.all([
            db.faceEnrollmentPhoto.count({ where: { photoPath: { in: aliases } } }),
            db.tenant.count({ where: { OR: [{ idCardImagePath: { in: aliases } }, { paymentSlipPath: { in: aliases } }] } }),
            db.payment.count({ where: { slipPath: { in: aliases } } }),
            db.paymentBatch.count({ where: { slipPath: { in: aliases } } }),
            db.idCardVerification.count({ where: { imagePath: { in: aliases } } }),
            db.ocrJob.count({ where: { imagePath: { in: aliases } } }),
            db.visitor.count({ where: { idCardImagePath: { in: aliases } } }),
          ]);
          if (references.some(count => count > 0)) throw new AppError('Face photo is still referenced', 409);
          try {
            this.resolvePhoto(await fs.realpath(target));
            const stat = await fs.lstat(target);
            if (!stat.isFile() || stat.isSymbolicLink()) throw new AppError('Unsafe face photo path', 409);
            await fs.unlink(target);
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        await db.systemSetting.updateMany({ where: { id: row.id, value: snapshot }, data: { value: JSON.stringify({ ...job, phase: 'DONE', paths: [] }) } });
      }
    } catch (error) {
      logger.warn({ error, userId: job.kind === 'user' ? job.id : undefined, visitorId: job.kind === 'visitor' ? job.id : undefined, taskKey }, 'Face cleanup pending retry');
    }
    return this.status(taskKey, db);
  }
  static async processAll(db: typeof prisma = prisma) {
    const rows = await db.systemSetting.findMany({ where: { category: FACE_CLEANUP_CATEGORY } });
    for (const row of rows) {
      try { if (this.parse(row.value).phase !== 'DONE') await this.process(row.key, db); }
      catch (error) { logger.error({ error, taskKey: row.key }, 'Invalid face cleanup job requires review'); }
    }
  }
}
