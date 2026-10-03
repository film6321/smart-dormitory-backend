/// <reference lib="dom" />

import fs from 'fs/promises';
import path from 'path';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../database/db';
import { getRedisClient } from '../../shared/redis';
import { AppError } from '../../middlewares/error-handler';
import { logger } from '../../logger';
import { faceVerificationMonitoringBus, type CameraScanSnapshot } from './face-verification-monitoring';
import {
  FaceRegisterResponse,
  FaceVerifyResponse,
  FaceTemplateResponse,
  FaceDeleteResponse,
} from './face-verification.types';

type FaceEnrollmentPhotoWithRelations = Prisma.FaceEnrollmentPhotoGetPayload<{
  include: { user:{
              select: {
                id: true,
                role: true,
              }
            }; visitor: true };
}>;

type FaceEmbeddingSummary = {
  student_code: string;
  model_version: string;
  vectors: number[][];
};

type PendingEnrollmentGroup = {
  student_id: number;
  student_code: string;
  photos: Array<{ id: number; url: string }>;
};

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'face-photo');
const db = prisma;

export class FaceVerificationService {
  public static readonly DEFAULT_SIMILARITY_THRESHOLD = 0.68;
  private static readonly DEFAULT_DETECTION_INTERVAL = 4;
  private static readonly inMemoryCooldowns = new Map<string, number>();
  private static readonly simulatedDoorTimers = new Map<string, NodeJS.Timeout>();
  private static readonly simulatedDoorOpen = new Set<string>();

  private static async recordSimulatedDoorEvent(
    userId: number,
    deviceCode: string,
    action: 'unlock' | 'lock',
    trigger: 'MANUAL' | 'AUTO',
  ) {
    const now = new Date();
    const opening = action === 'unlock';
    const accessLog = await db.accessLog.create({
      data: {
        userId,
        method: 'MONITOR_DOOR',
        path: opening ? 'DOOR_OPEN_MANUAL' : trigger === 'AUTO' ? 'DOOR_CLOSE_AUTO' : 'DOOR_CLOSE_MANUAL',
        ip: deviceCode,
        createdAt: now,
      },
    });
    faceVerificationMonitoringBus.recordDoorAction({
      id: `db-${accessLog.id}`,
      student_code: `admin_${userId}`,
      direction: opening ? 'IN' : 'OUT',
      confidence: 1,
      scanned_at: now.toISOString(),
      device_code: deviceCode,
      action: opening ? 'door_open_manual' : trigger === 'AUTO' ? 'door_close_auto' : 'door_close_manual',
      door_trigger: trigger,
      student: { code: `admin_${userId}`, name: `Admin #${userId}`, room: 'Main gate' },
    });
    return now;
  }

  static getSimulatedDoorStatus(deviceCode: string): 'OPEN' | 'CLOSED' {
    return this.simulatedDoorOpen.has(deviceCode) ? 'OPEN' : 'CLOSED';
  }

  static async getMonitorHistory(now = new Date()) {
    // Bangkok has a fixed UTC+7 offset. Use a half-open day range independent of host TZ.
    const offset = 7 * 60 * 60 * 1000;
    const local = new Date(now.getTime() + offset);
    const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offset);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const range = { gte: start, lt: end };

    const snapshot = await db.$transaction(async (tx) => {
      const [logs, visitorLogs, residentCounts, visitorCounts] = await Promise.all([
        tx.accessLog.findMany({
          where: { method: { in: ['FACE_GATE', 'MONITOR_DOOR'] }, createdAt: range },
          include: { user: { select: { id: true, username: true, email: true,
            tenant: { select: { fullName: true, room: { select: { roomNumber: true } } } } } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 30,
        }),
        tx.visitorLog.findMany({
          where: { eventType: { in: ['CHECK_IN', 'CHECK_OUT'] }, createdAt: range },
          include: { visitor: { select: { id: true, guestName: true } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 30,
        }),
        tx.accessLog.groupBy({ by: ['path'],
          where: { method: 'FACE_GATE', path: { in: ['IN', 'OUT', 'CHECKIN', 'CHECKOUT'] }, createdAt: range },
          _count: { _all: true } }),
        tx.visitorLog.groupBy({ by: ['eventType'],
          where: { eventType: { in: ['CHECK_IN', 'CHECK_OUT'] }, createdAt: range },
          _count: { _all: true } }),
      ]);
      return { logs, visitorLogs, residentCounts, visitorCounts };
    }, { isolationLevel: 'RepeatableRead' });

    const scans: CameraScanSnapshot[] = snapshot.logs.map((log) => {
      const door = log.method === 'MONITOR_DOOR';
      const opening = log.path === 'DOOR_OPEN_MANUAL';
      const out = door ? !opening : log.path === 'OUT' || log.path === 'CHECKOUT';
      const code = log.userId ? `${door ? 'admin' : 'user'}_${log.userId}` : 'unknown';
      return {
        id: `db-${log.id}`, student_code: code, direction: out ? 'OUT' : 'IN',
        confidence: door ? 1 : log.duration !== null ? Math.min(1, Math.max(0, log.duration / 100)) : 0,
        scanned_at: log.createdAt.toISOString(), device_code: log.ip || 'MAIN_GATE_01',
        action: door ? opening ? 'door_open_manual' : log.path === 'DOOR_CLOSE_AUTO' ? 'door_close_auto' : 'door_close_manual'
          : out ? 'checkout' : 'checkin',
        activity_type: door ? 'DOOR' : 'FACE_SCAN',
        ...(door ? { door_trigger: log.path === 'DOOR_CLOSE_AUTO' ? 'AUTO' as const : 'MANUAL' as const } : {}),
        student: { code,
          name: log.user?.tenant?.fullName || log.user?.username || log.user?.email || 'ผู้ใช้งาน',
          room: door ? 'Main gate' : log.user?.tenant?.room?.roomNumber || 'Resident' },
      };
    });
    for (const log of snapshot.visitorLogs) {
      const score = Number(log.note?.match(/confidence: ([0-9.]+)/)?.[1] ?? 0);
      const code = `visitor_${log.visitorId}`;
      scans.push({ id: `visitor-db-${log.id}`, student_code: code,
        direction: log.eventType === 'CHECK_OUT' ? 'OUT' : 'IN',
        action: log.eventType === 'CHECK_OUT' ? 'checkout' : 'checkin', activity_type: 'FACE_SCAN',
        confidence: Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0,
        scanned_at: log.createdAt.toISOString(), student: { code, name: log.visitor.guestName, room: 'Visitor' } });
    }
    let inCount = 0;
    let outCount = 0;
    for (const group of snapshot.residentCounts) {
      if (group.path === 'IN' || group.path === 'CHECKIN') inCount += group._count._all;
      else outCount += group._count._all;
    }
    for (const group of snapshot.visitorCounts) {
      if (group.eventType === 'CHECK_IN') inCount += group._count._all;
      else outCount += group._count._all;
    }
    const items = scans.sort((a, b) => Date.parse(b.scanned_at) - Date.parse(a.scanned_at) || b.id.localeCompare(a.id)).slice(0, 30);
    return { scans: items, items, today_counts: { in: inCount, out: outCount, total: inCount + outCount },
      timezone: 'Asia/Bangkok', day_start: start.toISOString(), day_end: end.toISOString(),
      door_status: this.getSimulatedDoorStatus('MAIN_GATE_01') };
  }

  static async commandSimulatedDoor(userId: number, deviceCode: string, action: 'unlock' | 'lock') {
    if (!Number.isInteger(userId) || userId <= 0) throw new AppError('Invalid admin identity', 401);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(deviceCode)) throw new AppError('Invalid device_code', 400);

    if (action === 'unlock') {
      if (this.simulatedDoorOpen.has(deviceCode)) throw new AppError('Door is already open', 409);
      const openedAt = await this.recordSimulatedDoorEvent(userId, deviceCode, action, 'MANUAL');
      this.simulatedDoorOpen.add(deviceCode);
      const timer = setTimeout(() => {
        this.simulatedDoorTimers.delete(deviceCode);
        this.simulatedDoorOpen.delete(deviceCode);
        void this.recordSimulatedDoorEvent(userId, deviceCode, 'lock', 'AUTO').catch((error) => {
          logger.error({ error, deviceCode, userId }, 'Failed to persist simulated door auto-close event');
        });
      }, 5000);
      timer.unref?.();
      this.simulatedDoorTimers.set(deviceCode, timer);
      return { status: 'OPEN', simulated: true, auto_close_at: new Date(openedAt.getTime() + 5000).toISOString() };
    }

    if (!this.simulatedDoorOpen.has(deviceCode)) {
      return { status: 'CLOSED', simulated: true, already_closed: true };
    }
    await this.recordSimulatedDoorEvent(userId, deviceCode, 'lock', 'MANUAL');
    const timer = this.simulatedDoorTimers.get(deviceCode);
    if (timer) clearTimeout(timer);
    this.simulatedDoorTimers.delete(deviceCode);
    this.simulatedDoorOpen.delete(deviceCode);
    return { status: 'CLOSED', simulated: true, already_closed: false };
  }

  private static shouldUseRedis(): boolean {
    return (
      process.env.NODE_ENV !== 'test' &&
      (process.env.NODE_ENV === 'production' || process.env.RATE_LIMIT_STORE === 'redis' || Boolean(process.env.REDIS_URL))
    );
  }

  /**
   * Acquire a distributed cooldown lock via Redis, with in-memory TTL fallback.
   * Returns true if lock was acquired (first scan in cooldown window), false if duplicate/within cooldown.
   */
  static async acquireCooldownLock(key: string, ttlMs: number = 5000): Promise<boolean> {
    const now = Date.now();
    const memExpiry = this.inMemoryCooldowns.get(key);
    if (memExpiry && memExpiry > now) {
      return false;
    }

    if (this.shouldUseRedis()) {
      try {
        const redis = getRedisClient();
        const result = await redis.set(key, '1', 'PX', ttlMs, 'NX');
        if (result !== 'OK') {
          return false;
        }
        this.inMemoryCooldowns.set(key, now + ttlMs);
        return true;
      } catch {
        // Fallback to in-memory on redis connection error
      }
    }

    this.inMemoryCooldowns.set(key, now + ttlMs);
    if (this.inMemoryCooldowns.size > 1000) {
      for (const [k, exp] of this.inMemoryCooldowns.entries()) {
        if (exp <= now) this.inMemoryCooldowns.delete(k);
      }
    }
    return true;
  }

  static clearCooldowns(): void {
    this.inMemoryCooldowns.clear();
  }

  static resolveDetectionInterval(interval?: string | number | null): number {
    if (interval === undefined || interval === null || interval === '') {
      return this.DEFAULT_DETECTION_INTERVAL;
    }

    const parsed = typeof interval === 'number' ? interval : Number(interval);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return this.DEFAULT_DETECTION_INTERVAL;
    }

    return Math.floor(parsed);
  }

  static shouldProcessFrame(frameIndex: number, interval: number): boolean {
    return frameIndex % interval === 0;
  }

  /**
   * Registers a face photo by saving it to disk and recording it in FaceEnrollmentPhoto
   * and forwarding the photo to the Python Face Recognition API for embedding extraction.
   */
  static async registerFace(
    userId: number,
    fileBuffer: Buffer,
    mimeType: string,
    fileName: string
  ): Promise<FaceRegisterResponse['data']> {
    logger.info({ userId, fileName }, 'Registering face photo, saving pending file to disk');

    // Use the same explicit visitor namespace as the Edge enrollment contract.
    if (!Number.isSafeInteger(userId) || userId <= 0 || userId === 1000000) {
      throw new AppError('Invalid face owner ID', 400);
    }
    const visitorId = userId > 1000000 ? userId - 1000000 : null;
    const actualUserId = visitorId === null ? userId : null;
    const owner = visitorId !== null
      ? await db.visitor.findUnique({ where: { id: visitorId } })
      : await db.user.findUnique({ where: { id: userId } });
    if (!owner) throw new AppError('Face owner not found', 404);
    if (owner.faceRevokedAt) throw new AppError('Face access is revoked; administrator review is required', 403);

    // 2. Save physical image to disk under uploads/face-photo/
    try {
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      const ext = path.extname(fileName) || '.jpg';
      const cleanFileName = `${actualUserId ? 'user' : 'visitor'}_${userId}_${Date.now()}${ext}`;
      const fullPath = path.join(UPLOAD_DIR, cleanFileName);
      await fs.writeFile(fullPath, fileBuffer);

      const relativePath = path.join('uploads', 'face-photo', cleanFileName);

      // 3. Create metadata record in FaceEnrollmentPhoto
      const photo = await db.faceEnrollmentPhoto.create({
        data: {
          userId: actualUserId,
          visitorId: visitorId,
          photoPath: relativePath,
        },
      });

      // 4. Forward photo to external Python Face Recognition API if configured
      await this.forwardRegisterToExternalApi(userId, fileBuffer, mimeType, cleanFileName);

      return {
        id: photo.id,
        user_id: userId,
        model_name: 'buffalo_l',
        embedding_version: 'v1',
        created_at: photo.createdAt.toISOString(),
        updated_at: photo.createdAt.toISOString(),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, userId }, 'Failed to save register face photo');
      throw new AppError('Failed to register face template', 500);
    }
  }

  /**
   * Helper to forward face registration to the external Python Face API
   */
  private static async forwardRegisterToExternalApi(
    userId: number,
    fileBuffer: Buffer,
    mimeType: string,
    fileName: string
  ): Promise<void> {
    const rawUrl = process.env.FACE_API_URL?.trim() || 'http://127.0.0.1:8000';
    const baseUrl = rawUrl.replace(/\/+$/u, '').replace(/\/api\/v1\/?$/u, '').replace(/\/faces\/?$/u, '');
    const endpoint = `${baseUrl}/api/v1/faces/register`;
    const apiKey = process.env.FACE_API_KEY?.trim();
    if (!apiKey) {
      throw new AppError('FACE_API_KEY is not configured', 500);
    }

    try {
      if (typeof fetch !== 'function') throw new AppError('Face service unavailable', 503);

      const fileArrayBuffer = fileBuffer.buffer.slice(
        fileBuffer.byteOffset,
        fileBuffer.byteOffset + fileBuffer.byteLength
      ) as ArrayBuffer;

      const formData = new FormData();
      formData.append('user_id', String(userId));
      formData.append('file', new Blob([fileArrayBuffer], { type: mimeType }), fileName);

      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
        headers: {
          'X-API-Key': apiKey,
        },
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        logger.info({ userId, endpoint }, 'Successfully forwarded face registration to Python API');
      } else {
        await response.arrayBuffer();
        throw new AppError('Face enrollment was not accepted; access is not granted', 502);
      }
    } catch (error) {
      logger.warn({ userId, error }, 'Face enrollment remains incomplete');
      throw new AppError('Face enrollment incomplete; retry after the face service is available', 502);
    }
  }

  /**
   * Normalizes the Face API endpoint URL
   */
  private static normalizeFaceApiUrl(): string {
    const rawUrl = process.env.FACE_API_URL?.trim() || 'http://127.0.0.1:8000';
    const baseUrl = rawUrl.replace(/\/+$/u, '');
    if (baseUrl.endsWith('/api/v1/faces/verify') || baseUrl.endsWith('/faces/verify')) {
      return baseUrl;
    }
    if (baseUrl.endsWith('/api/v1')) {
      return `${baseUrl}/faces/verify`;
    }
    return `${baseUrl}/api/v1/faces/verify`;
  }

  /**
   * Safe fallback for when Face API is unreachable or returns invalid data.
   * STRICT SECURITY: Always defaults to NOT_MATCHED (matched: false) to prevent unauthorized access.
   */
  private static createMockFaceVerificationResult(
    _fileBuffer: Buffer,
    _fileName: string,
    _threshold?: number,
  ): FaceVerifyResponse {
    return {
      matched: false,
      user_id: null,
      similarity: 0.1,
      processing_time_ms: 50,
      message: 'Face did not match registered templates',
    };
  }

  private static async callExternalFaceApi(
    fileBuffer: Buffer,
    mimeType: string,
    fileName: string,
    threshold?: number,
  ): Promise<FaceVerifyResponse> {
    const endpoint = this.normalizeFaceApiUrl();
    const apiKey = process.env.FACE_API_KEY?.trim();
    if (!apiKey) {
      throw new AppError('FACE_API_KEY is not configured', 500);
    }

    if (typeof fetch !== 'function') {
      throw new AppError('Runtime fetch API is not available', 500);
    }

    const effectiveThreshold =
      threshold !== undefined && threshold > 0
        ? threshold
        : Number(process.env.FACE_SIMILARITY_THRESHOLD || this.DEFAULT_SIMILARITY_THRESHOLD);

    try {
      const fileArrayBuffer = fileBuffer.buffer.slice(
        fileBuffer.byteOffset,
        fileBuffer.byteOffset + fileBuffer.byteLength
      ) as ArrayBuffer;

      const formData = new FormData();
      formData.append('file', new Blob([fileArrayBuffer], { type: mimeType }), fileName);
      formData.append('threshold', String(effectiveThreshold));

      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
        headers: {
          'X-API-Key': apiKey,
        },
        signal: AbortSignal.timeout(4000),
      });

      if (!response.ok) {
        await response.arrayBuffer();
        logger.warn({ endpoint, status: response.status, fileName }, 'Face API returned non-ok status');
        return this.createMockFaceVerificationResult(fileBuffer, fileName, effectiveThreshold);
      }

      const result = await response.json();
      if (typeof result !== 'object' || result === null) {
        throw new AppError('Face recognition service returned invalid JSON', 502);
      }

      const rawMatched = result.matched === true;
      const similarity = Number(result.similarity ?? 0);

      // Strict Threshold Guardrail:
      // Even if external API returns matched, ensure similarity meets the effective threshold to prevent false positives
      const matched = rawMatched && Number.isFinite(similarity) && similarity <= 1 && similarity >= effectiveThreshold
        && Number.isSafeInteger(result.user_id) && result.user_id > 0 && result.user_id !== 1000000;
      const matchedUserId = matched && result.user_id !== undefined && result.user_id !== null ? Number(result.user_id) : null;
      let userName = matched ? result.message : undefined;

      if (matched && matchedUserId) {
        const owner = matchedUserId > 1000000
          ? await db.visitor.findUnique({ where: { id: matchedUserId - 1000000 } })
          : await db.user.findUnique({ where: { id: matchedUserId } });
        if (!owner || owner.faceRevokedAt) return this.createMockFaceVerificationResult(fileBuffer, fileName, effectiveThreshold);
        userName = 'guestName' in owner ? owner.guestName : owner.username || owner.email;
      }

      return {
        matched,
        user_id: matchedUserId,
        similarity,
        processing_time_ms: Number(result.processing_time_ms ?? 0),
        message: matched ? (userName || 'Face matched successfully') : 'Face did not match registered templates',
      };
    } catch (error) {
      logger.warn({ fileName, error }, 'External Face API call failed or timed out; safe deny fallback applied');
      return this.createMockFaceVerificationResult(fileBuffer, fileName, effectiveThreshold);
    }
  }

  static async verifyFace(
    fileBuffer: Buffer,
    mimeType: string,
    fileName: string,
    threshold?: number
  ): Promise<FaceVerifyResponse> {
    try {
      const data = await this.callExternalFaceApi(fileBuffer, mimeType, fileName, threshold);
      return data;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error({ error, fileName }, 'Face verification error via external service');
      throw new AppError('Face recognition service unavailable', 502);
    }
  }

  /**
   * Retrieves face embedding details.
   */
  static async getFaceTemplate(templateId: number): Promise<FaceTemplateResponse> {
    const photo = await db.faceEnrollmentPhoto.findUnique({ where: { id: templateId } });
    if (!photo) throw new AppError('Enrollment photo not found', 404);
    return {
      id: photo.id,
      user_id: photo.userId ?? (photo.visitorId! + 1000000),
      model_name: 'buffalo_l', embedding_version: 'v1',
      created_at: photo.createdAt.toISOString(), updated_at: photo.createdAt.toISOString(),
    };
  }

  static async updateFaceTemplate(
    templateId: number, fileBuffer: Buffer, mimeType: string, fileName: string
  ): Promise<FaceRegisterResponse['data']> {
    const existing = await db.faceEnrollmentPhoto.findUnique({ where: { id: templateId } });
    if (!existing) throw new AppError('Enrollment photo not found', 404);
    const userId = existing.userId ?? (existing.visitorId! + 1000000);
    return this.registerFace(userId, fileBuffer, mimeType, fileName);
  }

  static async deleteFaceTemplate(templateId: number): Promise<FaceDeleteResponse> {
    const photo = await db.faceEnrollmentPhoto.findUnique({ where: { id: templateId } });
    if (!photo) throw new AppError('Enrollment photo not found', 404);
    if ((photo.userId === null) === (photo.visitorId === null)) throw new AppError('Ambiguous face owner', 409);
    const where = photo.userId !== null ? { userId: photo.userId } : { visitorId: photo.visitorId! };
    // Persist denial first. Failures below remain retryable and must never restore access.
    if (photo.userId !== null) {
      await db.user.update({ where: { id: photo.userId }, data: { faceRevokedAt: new Date() } });
    } else {
      await db.visitor.update({ where: { id: photo.visitorId! }, data: { faceRevokedAt: new Date() } });
    }
    const ownerId = photo.userId ?? (photo.visitorId! + 1000000);
    const endpoint = this.normalizeFaceApiUrl().replace(/\/verify$/, `/owners/${ownerId}`);
    const apiKey = process.env.FACE_API_KEY?.trim();
    if (!apiKey) throw new AppError('Face access revoked; external deletion is pending configuration', 503);
    try {
      const response = await fetch(endpoint, {
        method: 'DELETE', headers: { 'X-API-Key': apiKey }, signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('External deletion failed');
      const result = await response.json();
      if (result.success !== true) throw new Error('External deletion not confirmed');
    } catch {
      throw new AppError('Face access revoked; external deletion incomplete, please retry', 502);
    }
    const photos = await db.faceEnrollmentPhoto.findMany({ where });
    for (const item of photos) {
      const fullPath = path.resolve(process.cwd(), item.photoPath);
      const relative = path.relative(UPLOAD_DIR, fullPath);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new AppError('Face access revoked; invalid photo path requires administrator review', 409);
      }
      try { await fs.unlink(fullPath); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new AppError('Face access revoked; file deletion incomplete, please retry', 503);
        }
      }
    }
    await db.$transaction(async (tx) => {
      await tx.faceEmbedding.deleteMany({ where });
      await tx.faceEnrollmentPhoto.deleteMany({ where });
    });
    return { success: true, message: 'Face access revoked and all enrollment data deleted' };
  }

  // ── C# Edge integrations ──

  /**
   * Sync active face embeddings (since optional date)
   */
  static async getEmbeddings(since?: string) {
    const whereClause: Prisma.FaceEmbeddingWhereInput = { OR: [{ user: { faceRevokedAt: null } }, { visitor: { faceRevokedAt: null } }] };
    if (since) {
      const parsedDate = new Date(since);
      if (!Number.isNaN(parsedDate.getTime())) {
        whereClause.updatedAt = { gt: parsedDate };
      }
    }

    const embeddings = await db.faceEmbedding.findMany({
      where: whereClause,
      include: {
        user:{
              select: {
                id: true,
                role: true,
              }
            },
        visitor: true,
      },
    });

    const data = embeddings.reduce<FaceEmbeddingSummary[]>((acc, current) => {
      const studentCode = current.userId
        ? `user_${current.userId}`
        : `visitor_${current.visitorId}`;

      let group = acc.find((item) => item.student_code === studentCode);
      if (!group) {
        group = {
          student_code: studentCode,
          model_version: current.modelVersion,
          vectors: [],
        };
        acc.push(group);
      }
      group.vectors.push(current.vector);
      return acc;
    }, []);

    return {
      data,
      synced_at: new Date().toISOString(),
    };
  }

  /**
   * List pending enrollment photos Grouped by User/Visitor
   */
  static async getPendingEnrollments() {
    // Get all FaceEnrollmentPhotos where the User or Visitor has no FaceEmbeddings yet
    const pendingPhotos = await db.faceEnrollmentPhoto.findMany({
      where: {
        OR: [
          {
            user: {
              faceRevokedAt: null,
              faceEmbeddings: {
                none: {},
              },
            },
          },
          {
            visitor: {
              faceRevokedAt: null,
              faceEmbeddings: {
                none: {},
              },
            },
          },
        ],
      },
      include: {
        user:{
              select: {
                id: true,
                role: true,
              }
            },
        visitor: true,
      },
    }) as FaceEnrollmentPhotoWithRelations[];

    const grouped = pendingPhotos.reduce<Map<string, PendingEnrollmentGroup>>((acc, photo) => {
      const key = photo.userId ? `user_${photo.userId}` : `visitor_${photo.visitorId}`;
      const studentId = photo.userId ? photo.userId : (photo.visitorId ? photo.visitorId + 1000000 : 0);
      const studentCode = key;

      if (!acc.has(key)) {
        acc.set(key, {
          student_id: studentId,
          student_code: studentCode,
          photos: [],
        });
      }

      acc.get(key)?.photos.push({
        id: photo.id,
        url: `enrollment/photo/${photo.id}`,
      });

      return acc;
    }, new Map());

    return {
      data: Array.from(grouped.values()),
    };
  }

  /**
   * Retrieve physical path of enrollment photo
   */
  static async getEnrollmentPhoto(photoId: number): Promise<string> {
    const photo = await db.faceEnrollmentPhoto.findUnique({
      where: { id: photoId },
    });

    if (!photo) {
      throw new AppError('Photo not found', 404);
    }

    const fullPath = path.resolve(process.cwd(), photo.photoPath);
    return fullPath;
  }

  /**
   * Store embeddings computed by C# Edge client
   */
  static async storeEmbeddings(
    studentId: number,
    modelVersion: string,
    vectors: number[][],
    qualityScores?: number[]
  ) {
    let userId: number | null = null;
    let visitorId: number | null = null;

    if (studentId >= 1000000) {
      visitorId = studentId - 1000000;
      const visitorExists = await db.visitor.findUnique({ where: { id: visitorId } });
      if (!visitorExists) {
        throw new AppError('Visitor not found', 404);
      }
      if (visitorExists.faceRevokedAt) throw new AppError('Face access revoked', 403);
    } else {
      userId = studentId;
      const userExists = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, faceRevokedAt: true },
      });
      if (!userExists) {
        throw new AppError('User not found', 404);
      }
      if (userExists.faceRevokedAt) throw new AppError('Face access revoked', 403);
    }

    let storedCount = 0;
    for (let i = 0; i < vectors.length; i++) {
      const vector = vectors[i];
      const score = qualityScores ? qualityScores[i] : null;

      await db.faceEmbedding.create({
        data: {
          userId,
          visitorId,
          vector,
          modelVersion,
          qualityScore: score,
        },
      });
      storedCount++;
    }

    logger.info({ studentId, storedCount, modelVersion }, 'Successfully stored face embeddings from Edge');
    return storedCount;
  }

  /**
   * Log real-time scan from FaceGate.Edge
   */
  static async recordScan(
    studentCode: string,
    direction: 'IN' | 'OUT',
    confidence: number,
    scannedAt: string,
    deviceCode?: string,
    _snapshotBase64?: string
  ) {
    if (!/^(user|visitor)_[1-9][0-9]*$/.test(studentCode) || !['IN', 'OUT'].includes(direction)
      || !Number.isFinite(confidence) || confidence < this.DEFAULT_SIMILARITY_THRESHOLD || confidence > 1
      || !Number.isFinite(Date.parse(scannedAt))) throw new AppError('Invalid face scan', 400);
    const visitorScan = studentCode.startsWith('visitor_');
    const id = Number(studentCode.split('_')[1]);
    return db.$transaction(async (tx) => {
      // Serialize access decisions against revocation and status changes.
      if (visitorScan) await tx.$queryRaw`SELECT id FROM "Visitor" WHERE id = ${id} FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
      const now = new Date();
      const normalizedDevice = deviceCode || 'EDGE_DEVICE';
      if (visitorScan) {
        const visitor = await tx.visitor.findUnique({ where: { id } });
        if (!visitor || visitor.faceRevokedAt || visitor.cancelledAt) throw new AppError('Visitor face access denied', 403);
        const allowed = direction === 'IN'
          ? visitor.status === 'APPROVED' && visitor.expiresAt !== null && visitor.expiresAt > now
            && (!visitor.expectedEntryTime || visitor.expectedEntryTime <= now)
          : visitor.status === 'CHECKED_IN';
        if (!allowed) throw new AppError('Visitor is not approved, has expired, or cannot make this transition', 403);
        const isFirst = await this.acquireCooldownLock(`lock:face-cooldown:visitor:${id}`, 5000);
        if (!isFirst) throw new AppError('Scan already being processed', 409);
        await tx.visitor.update({ where: { id }, data: {
          status: direction === 'IN' ? 'CHECKED_IN' : 'CHECKED_OUT',
          ...(direction === 'IN' ? { checkedInAt: now } : { checkedOutAt: now }),
        } });
        const log = await tx.visitorLog.create({ data: { visitorId: id, eventType: direction === 'IN' ? 'CHECK_IN' : 'CHECK_OUT',
          note: `Scanned on device: ${normalizedDevice} (confidence: ${confidence})`, createdAt: now } });
        return { status: 'ok', id: `visitor-db-${log.id}`, scanned_at: log.createdAt.toISOString(),
          action: direction === 'IN' ? 'checkin' : 'checkout', cooldown_active: false,
          student: { code: studentCode, name: visitor.guestName, room: 'Visitor' } };
      }
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE "userId" = ${id} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id }, include: { tenant: { include: { room: true } } } });
      if (!user || user.faceRevokedAt) throw new AppError('Face access denied', 403);
      const tenant = user.tenant;
      if (user.role !== 'ADMIN' && (!tenant || !tenant.isActive || !['APPROVED', 'ACTIVE'].includes(tenant.status)
        || !tenant.roomId || (tenant.checkInDate && tenant.checkInDate > now)
        || (tenant.checkOutDate && tenant.checkOutDate <= now))) throw new AppError('Resident has no active room access', 403);
      const isFirst = await this.acquireCooldownLock(`lock:face-cooldown:user:${id}:${normalizedDevice}`, 5000);
      const log = isFirst ? await tx.accessLog.create({ data: { userId: id, method: 'FACE_GATE', path: direction,
        ip: normalizedDevice, duration: Math.round(confidence * 100), createdAt: now } }) : null;
      return { status: 'ok', id: log ? `db-${log.id}` : null, scanned_at: log?.createdAt.toISOString() ?? null,
        action: direction === 'IN' ? 'checkin' : 'checkout', cooldown_active: !isFirst,
        student: { code: studentCode, name: tenant?.fullName || user.username || user.email,
          room: tenant?.room?.roomNumber || 'Resident' } };
    });
  }
}
