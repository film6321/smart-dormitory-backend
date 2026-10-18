import { PrivacyConsentService } from '../../src/modules/users/privacy-consent.service';
import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import { readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { FaceVerificationService } from '../../src/modules/face-verification/face-verification.service';
import { prisma } from '../../src/database/db';
import { Prisma } from '@prisma/client';
import { faceVerificationMonitoringBus, type CameraScanSnapshot } from '../../src/modules/face-verification/face-verification-monitoring';
import * as notificationGateway from '../../src/realtime/notification-gateway';

describe('FaceVerificationService (unit)', () => {
  const restorers: Array<() => void> = [];
  function stub<T extends object, K extends keyof T>(target: T, key: K, implementation: unknown) {
    const original = target[key];
    const replacement = mock.fn(implementation as (...args: unknown[]) => unknown);
    Reflect.set(target, key, replacement);
    restorers.push(() => { Reflect.set(target, key, original); });
    return replacement;
  }
  beforeEach(() => {
    stub(PrivacyConsentService, 'require', async () => undefined);
    stub(prisma.faceEnrollmentPhoto, 'findFirst', async () => null);
    const apiKey = process.env.FACE_API_KEY; process.env.FACE_API_KEY = 'synthetic-test-key';
    restorers.push(() => { if (apiKey === undefined) delete process.env.FACE_API_KEY; else process.env.FACE_API_KEY = apiKey; });
    stub(prisma, '$transaction', async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
    stub(prisma, '$queryRaw', async () => []);
    stub(prisma.user, 'update', async () => ({}));
    let setting: { id: number; key: string; category: string; value: string } | null = null;
    stub(prisma.systemSetting, 'findUnique', async () => setting);
    stub(prisma.systemSetting, 'findMany', async () => setting ? [setting] : []);
    stub(prisma.systemSetting, 'upsert', async ({ create, update }: { create: typeof setting; update: { value: string } }) => { setting = setting ? { ...setting, ...update } : { ...create!, id: 1 }; return setting; });
    stub(prisma.systemSetting, 'updateMany', async ({ where, data }: { where: { value: string }; data: { value: string } }) => {
      if (!setting || setting.value !== where.value) return { count: 0 };
      setting = { ...setting, ...data }; return { count: 1 };
    });
    for (const model of [prisma.tenant, prisma.payment, prisma.paymentBatch, prisma.housingRefund, prisma.idCardVerification, prisma.ocrJob, prisma.visitor, prisma.faceEnrollmentPhoto]) stub(model, 'count', async () => 0);

    stub(prisma.faceEnrollmentPhoto, 'findUnique', async () => ({
      id: 12, userId: 99, visitorId: null, photoPath: 'uploads/face-photo/test.jpg', createdAt: new Date(),
    }));
    stub(prisma.faceEnrollmentPhoto, 'findMany', async () => []);
    stub(prisma.faceEnrollmentPhoto, 'deleteMany', async () => ({ count: 1 }));
    stub(prisma.faceEmbedding, 'deleteMany', async () => ({ count: 1 }));
    stub(globalThis, 'fetch', async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
  });
  afterEach(() => { while (restorers.length) restorers.pop()!(); mock.restoreAll(); });
  // Save originals to restore
  const originalUserFindUnique = prisma.user.findUnique.bind(prisma);
  const originalVisitorFindUnique = prisma.visitor.findUnique.bind(prisma);
  const originalPhotoCreate = prisma.faceEnrollmentPhoto.create.bind(prisma);
  const originalEmbeddingFindUnique = prisma.faceEmbedding.findUnique.bind(prisma);
  const originalEmbeddingDelete = prisma.faceEmbedding.delete.bind(prisma);
  const originalEmbeddingCreate = prisma.faceEmbedding.create.bind(prisma);
  const originalEmbeddingFindMany = prisma.faceEmbedding.findMany.bind(prisma);
  const originalPhotoFindMany = prisma.faceEnrollmentPhoto.findMany.bind(prisma);
  const originalPhotoFindUnique = prisma.faceEnrollmentPhoto.findUnique.bind(prisma);
  const originalAccessLogCreate = prisma.accessLog.create.bind(prisma);
  const originalVisitorUpdate = prisma.visitor.update.bind(prisma);
  const originalVisitorLogCreate = prisma.visitorLog.create.bind(prisma);

  const restorePrisma = () => {
    prisma.user.findUnique = originalUserFindUnique;
    prisma.visitor.findUnique = originalVisitorFindUnique;
    prisma.faceEnrollmentPhoto.create = originalPhotoCreate;
    prisma.faceEmbedding.findUnique = originalEmbeddingFindUnique;
    prisma.faceEmbedding.delete = originalEmbeddingDelete;
    prisma.faceEmbedding.create = originalEmbeddingCreate;
    prisma.faceEmbedding.findMany = originalEmbeddingFindMany;
    prisma.faceEnrollmentPhoto.findMany = originalPhotoFindMany;
    prisma.faceEnrollmentPhoto.findUnique = originalPhotoFindUnique;
    prisma.accessLog.create = originalAccessLogCreate;
    prisma.visitor.update = originalVisitorUpdate;
    prisma.visitorLog.create = originalVisitorLogCreate;
  };

  it('retry after external failure reuses the saved photo instead of creating another record', async () => {
    let photo: { id: number; userId: number; visitorId: null; photoPath: string; createdAt: Date } | null = null;
    let creates = 0; let forwards = 0;
    stub(prisma.user, 'findUnique', async () => ({ id: 99, faceRevokedAt: null }));
    stub(prisma.faceEnrollmentPhoto, 'findFirst', async () => photo);
    stub(prisma.faceEnrollmentPhoto, 'create', async ({ data }: { data: { photoPath: string } }) => {
      creates++; photo = { id: 900, userId: 99, visitorId: null, photoPath: data.photoPath, createdAt: new Date() }; return photo;
    });
    stub(globalThis, 'fetch', async () => { forwards++; return new Response(JSON.stringify({ success: forwards > 1 }), { status: forwards === 1 ? 503 : 200 }); });
    const bytes = Buffer.from(`synthetic face retry ${randomUUID()}`);
    try {
      await assert.rejects(FaceVerificationService.registerFace(99, bytes, 'image/jpeg', 'retry.jpg'));
      const result = await FaceVerificationService.registerFace(99, bytes, 'image/jpeg', 'retry.jpg');
      assert.equal(result.id, 900); assert.equal(creates, 1); assert.equal(forwards, 2);
    } finally {
      const saved = photo as { photoPath: string } | null;
      if (saved) { const target = path.resolve(saved.photoPath); const root = path.resolve('uploads/face-photo'); assert.ok(target.startsWith(root + path.sep)); rmSync(target, { force: true }); }
    }
  });

  it('successfully registers a face', async () => {
    prisma.user.findUnique = (async ({ where }: Prisma.UserFindUniqueArgs) => {
      if (where.id === 99) {
        return {
          id: 99,
          email: 'student@dorm.ac.th',
          username: 'student99',
          password: 'hashedpassword',
          role: 'STUDENT',
          lastLogin: null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      return null;
    }) as unknown as typeof prisma.user.findUnique;

    prisma.faceEnrollmentPhoto.create = (async ({ data }: Prisma.FaceEnrollmentPhotoCreateArgs) => {
      return {
        id: 12,
        userId: typeof data.user?.connect?.id === 'number' ? data.user.connect.id : null,
        visitorId: typeof data.visitor?.connect?.id === 'number' ? data.visitor.connect.id : null,
        photoPath: data.photoPath,
        createdAt: new Date('2026-07-06T18:00:00Z'),
      };
    }) as unknown as typeof prisma.faceEnrollmentPhoto.create;

    try {
      const buffer = Buffer.from('fake-image-bytes');
      const result = await FaceVerificationService.registerFace(
        99,
        buffer,
        'image/jpeg',
        'avatar.jpg'
      );

      assert.equal(result.id, 12);
      assert.equal(result.user_id, 99);
      assert.equal(result.model_name, 'buffalo_l');
    } finally {
      restorePrisma();
    }
  });

  it('verifies a real enrollment image through the external API contract', async () => {
    const originalFetch = globalThis.fetch;
    prisma.user.findUnique = (async ({ where }: Prisma.UserFindUniqueArgs) => {
      if (where.id === 99) {
        return {
          id: 99,
          email: 'resident@dorm.ac.th',
          username: 'resident99',
          password: 'hashedpassword',
          role: 'STUDENT',
          lastLogin: null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      return null;
    }) as unknown as typeof prisma.user.findUnique;

    prisma.accessLog.create = (async ({ data }: Prisma.AccessLogCreateArgs) => ({
      id: 1,
      userId: typeof data.user?.connect?.id === 'number' ? data.user.connect.id : null,
      method: data.method,
      path: data.path,
      ip: data.ip ?? null,
      duration: data.duration ?? null,
      createdAt: new Date(),
    })) as unknown as typeof prisma.accessLog.create;

    globalThis.fetch = (async () => new Response(JSON.stringify({
      matched: true,
      user_id: 99,
      similarity: 0.97,
      processing_time_ms: 42,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    try {
      const buffer = readFileSync(path.resolve(__dirname, '../fixtures/face-enrollment-user-2.jpg'));
      const result = await FaceVerificationService.verifyFace(
        buffer,
        'image/jpeg',
        'face-enrollment-user-2.jpg',
        0.65
      );

      assert.equal(result.matched, true);
      assert.equal(result.user_id, 99);
      assert.equal(result.similarity, 0.97);
    } finally {
      globalThis.fetch = originalFetch;
      restorePrisma();
    }
  });

  it('throttles frame processing based on the configured interval', () => {
    assert.equal(FaceVerificationService.resolveDetectionInterval('4'), 4);
    assert.equal(FaceVerificationService.resolveDetectionInterval('0'), 4);
    assert.equal(FaceVerificationService.resolveDetectionInterval('10'), 10);
    assert.equal(FaceVerificationService.shouldProcessFrame(1, 4), false);
    assert.equal(FaceVerificationService.shouldProcessFrame(4, 4), true);
    assert.equal(FaceVerificationService.shouldProcessFrame(8, 4), true);
    assert.equal(FaceVerificationService.shouldProcessFrame(1, 1), true);
  });

  it('manages face templates via service methods', async () => {
    prisma.faceEmbedding.findUnique = (async ({ where }: Prisma.FaceEmbeddingFindUniqueArgs) => {
      if (where.id === 12) {
        return {
          id: 12,
          userId: 99,
          visitorId: null,
          vector: [0.1, 0.2],
          modelVersion: 'buffalo_l',
          qualityScore: 0.95,
          createdAt: new Date('2026-07-06T18:00:00Z'),
          updatedAt: new Date('2026-07-06T18:00:00Z'),
        };
      }
      return null;
    }) as unknown as typeof prisma.faceEmbedding.findUnique;

    prisma.user.findUnique = (async () => ({
      id: 99,
      email: 'student@dorm.ac.th',
      username: 'student99',
      password: 'hashedpassword',
      role: 'STUDENT',
      lastLogin: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as unknown as typeof prisma.user.findUnique;

    prisma.faceEnrollmentPhoto.create = (async ({ data }: Prisma.FaceEnrollmentPhotoCreateArgs) => ({
      id: 12,
      userId: typeof data.user?.connect?.id === 'number' ? data.user.connect.id : null,
      visitorId: typeof data.visitor?.connect?.id === 'number' ? data.visitor.connect.id : null,
      photoPath: data.photoPath,
      createdAt: new Date('2026-07-06T18:00:00Z'),
    })) as unknown as typeof prisma.faceEnrollmentPhoto.create;

    prisma.faceEmbedding.delete = (async ({ where }: Prisma.FaceEmbeddingDeleteArgs) => ({
      id: where.id ?? 12,
      userId: 99,
      visitorId: null,
      vector: [0.1, 0.2],
      modelVersion: 'buffalo_l',
      qualityScore: 0.95,
      createdAt: new Date('2026-07-06T18:00:00Z'),
      updatedAt: new Date('2026-07-06T18:00:00Z'),
    })) as unknown as typeof prisma.faceEmbedding.delete;

    try {
      const template = await FaceVerificationService.getFaceTemplate(12);
      assert.equal(template.id, 12);
      assert.equal(template.user_id, 99);

      const buffer = Buffer.from('fake-image-bytes-new');
      const updated = await FaceVerificationService.updateFaceTemplate(
        12,
        buffer,
        'image/jpeg',
        'updated.jpg'
      );
      assert.equal(updated.id, 12);

      const deleteRes = await FaceVerificationService.deleteFaceTemplate(12);
      assert.equal(deleteRes.success, true);
    } finally {
      restorePrisma();
    }
  });

  it('manages FaceGate.Edge sync and enrollment photos', async () => {
    // 1. getEmbeddings
    prisma.faceEmbedding.findMany = (async () => [
      {
        id: 1,
        userId: 99,
        visitorId: null,
        vector: [0.1, 0.2, 0.3],
        modelVersion: 'buffalo_l',
        qualityScore: 0.99,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]) as unknown as typeof prisma.faceEmbedding.findMany;

    // 2. getPendingEnrollments
    prisma.faceEnrollmentPhoto.findMany = (async () => [
      {
        id: 15,
        userId: 99,
        visitorId: null,
        photoPath: 'uploads/face-photo/user_99_file.jpg',
        createdAt: new Date(),
      },
    ]) as unknown as typeof prisma.faceEnrollmentPhoto.findMany;

    // 3. storeEmbeddings
    prisma.user.findUnique = (async () => ({
      id: 99,
      email: 'student@dorm.ac.th',
      username: 'student99',
      password: 'hashedpassword',
      role: 'STUDENT',
      lastLogin: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as unknown as typeof prisma.user.findUnique;

    const createdEmbeddings: Prisma.FaceEmbeddingCreateInput[] = [];
    prisma.faceEmbedding.create = (async ({ data }: Prisma.FaceEmbeddingCreateArgs) => {
      // storeEmbeddings uses TenantUncheckedCreateInput-style flat userId/visitorId fields
      const flat = data as Prisma.FaceEmbeddingUncheckedCreateInput;
      createdEmbeddings.push(data as Prisma.FaceEmbeddingCreateInput);
      return {
        id: 1,
        userId: typeof flat.userId === 'number' ? flat.userId : null,
        visitorId: typeof flat.visitorId === 'number' ? flat.visitorId : null,
        vector: data.vector as number[],
        modelVersion: data.modelVersion,
        qualityScore: data.qualityScore ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }) as unknown as typeof prisma.faceEmbedding.create;

    try {
      const embs = await FaceVerificationService.getEmbeddings();
      assert.equal(embs.data.length, 1);
      assert.equal(embs.data[0]?.student_code, 'user_99');

      const pendings = await FaceVerificationService.getPendingEnrollments();
      assert.equal(pendings.data.length, 1);
      assert.equal(pendings.data[0]?.student_id, 99);
      assert.equal(pendings.data[0]?.photos[0]?.id, 15);

      const count = await FaceVerificationService.storeEmbeddings(99, 'buffalo_l', [[0.1, 0.2, 0.3]]);
      assert.equal(count, 1);
      assert.equal(createdEmbeddings.length, 1);
      // storeEmbeddings uses flat userId field (TenantUncheckedCreateInput pattern)
      const flat0 = createdEmbeddings[0] as unknown as Prisma.FaceEmbeddingUncheckedCreateInput;
      assert.equal(flat0?.userId, 99);
      assert.deepEqual(createdEmbeddings[0]?.vector, [0.1, 0.2, 0.3]);
    } finally {
      restorePrisma();
    }
  });

  it('records attendance scan for user and visitor', async () => {
    // mock user check
    prisma.user.findUnique = (async ({ where }: Prisma.UserFindUniqueArgs) => {
      if (where.id === 99) {
        return {
          id: 99,
          username: 'John Doe',
          email: 'john@example.com',
          password: 'hashedpassword',
          role: 'STUDENT',
          lastLogin: null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          tenant: { fullName: 'John Doe', isActive: true, status: 'ACTIVE', roomId: 1 },
        };
      }
      return null;
    }) as unknown as typeof prisma.user.findUnique;

    const accessLogs: Prisma.AccessLogCreateInput[] = [];
    prisma.accessLog.create = (async ({ data }: Prisma.AccessLogCreateArgs) => {
      accessLogs.push(data as Prisma.AccessLogCreateInput);
      // recordScan uses flat userId field (AccessLogUncheckedCreateInput pattern)
      const flat = data as Prisma.AccessLogUncheckedCreateInput;
      return {
        id: 1,
        userId: typeof flat.userId === 'number' ? flat.userId : null,
        method: data.method,
        path: data.path,
        ip: data.ip ?? null,
        duration: data.duration ?? null,
        createdAt: new Date(),
      };
    }) as unknown as typeof prisma.accessLog.create;

    // mock visitor check
    prisma.visitor.findUnique = (async ({ where }: Prisma.VisitorFindUniqueArgs) => {
      if (where.id === 5) {
        return {
          id: 5,
          guestName: 'Jane Smith',
          checkedInAt: null,
          checkedOutAt: null,
          tenantId: null,
          roomId: null,
          phone: null,
          citizenId: null,
          citizenIdMasked: null,
          relationship: null,
          age: null,
          birthDate: null,
          address: null,
          idCardImagePath: null,
          purpose: null,
          expectedEntryTime: null,
          status: 'CHECKED_IN',
          pdpaConsent: true,
          pdpaConsentAt: new Date(),
          expiresAt: null,
          cancelledAt: null,
          qrCodeData: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      return null;
    }) as unknown as typeof prisma.visitor.findUnique;

    const visitorUpdates: Prisma.VisitorUpdateArgs[] = [];
    prisma.visitor.update = (async (args: Prisma.VisitorUpdateArgs) => {
      visitorUpdates.push(args);
      return {
        id: typeof args.where.id === 'number' ? args.where.id : 5,
        guestName: 'Jane Smith',
        status: typeof args.data.status === 'string' ? args.data.status : 'CHECKED_OUT',
        checkedInAt: null,
        checkedOutAt: new Date(),
        tenantId: null,
        roomId: null,
        phone: null,
        citizenId: null,
        citizenIdMasked: null,
        relationship: null,
        age: null,
        birthDate: null,
        address: null,
        idCardImagePath: null,
        purpose: null,
        expectedEntryTime: null,
        pdpaConsent: true,
        pdpaConsentAt: new Date(),
        expiresAt: null,
        cancelledAt: null,
        qrCodeData: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }) as unknown as typeof prisma.visitor.update;

    const visitorLogs: Prisma.VisitorLogCreateInput[] = [];
    prisma.visitorLog.create = (async ({ data }: Prisma.VisitorLogCreateArgs) => {
      visitorLogs.push(data as Prisma.VisitorLogCreateInput);
      return {
        id: 1,
        visitorId: typeof data.visitor?.connect?.id === 'number' ? data.visitor.connect.id : 5,
        eventType: data.eventType,
        note: data.note ?? null,
        createdAt: new Date(),
      };
    }) as unknown as typeof prisma.visitorLog.create;

    try {
      FaceVerificationService.clearCooldowns();
      const userScan = await FaceVerificationService.recordScan(
        'user_99',
        'IN',
        0.95,
        new Date().toISOString(),
        'CAMERA_01'
      );
      assert.equal(userScan.status, 'ok');
      assert.equal(userScan.action, 'checkin');
      assert.equal(userScan.cooldown_active, false);
      assert.equal(userScan.id, 'db-1');
      assert.ok(userScan.scanned_at && Number.isFinite(Date.parse(userScan.scanned_at)));
      assert.equal(userScan.student.name, 'John Doe');
      assert.equal(accessLogs.length, 1);
      // recordScan uses flat userId field
      const flatLog = accessLogs[0] as unknown as Prisma.AccessLogUncheckedCreateInput;
      assert.equal(flatLog?.userId, 99);
      assert.equal(accessLogs[0]?.path, 'IN');

      // Second rapid scan for the same user should activate cooldown and NOT create duplicate AccessLog
      const duplicateUserScan = await FaceVerificationService.recordScan(
        'user_99',
        'IN',
        0.96,
        new Date().toISOString(),
        'CAMERA_01'
      );
      assert.equal(duplicateUserScan.status, 'ok');
      assert.equal(duplicateUserScan.cooldown_active, true);
      assert.equal(duplicateUserScan.id, null);
      assert.equal(accessLogs.length, 1);

      const visitorScan = await FaceVerificationService.recordScan(
        'visitor_5',
        'OUT',
        0.82,
        new Date().toISOString(),
        'CAMERA_02'
      );
      assert.equal(visitorScan.status, 'ok');
      assert.equal(visitorScan.action, 'checkout');
      assert.equal(visitorScan.cooldown_active, false);
      assert.equal(visitorScan.id, 'visitor-db-1');
      assert.equal(visitorScan.student.name, 'Jane Smith');
      assert.equal(visitorUpdates.length, 1);
      assert.equal(visitorUpdates[0]?.data.status, 'CHECKED_OUT');
      assert.equal(visitorLogs.length, 1);
      // face-verification service uses flat visitorId field (VisitorLogUncheckedCreateInput pattern)
      const flatVLog = visitorLogs[0] as unknown as Prisma.VisitorLogUncheckedCreateInput;
      assert.equal(flatVLog?.visitorId, 5);
      assert.equal(visitorLogs[0]?.eventType, 'CHECK_OUT');

      // Duplicate visitor scan in cooldown
      await assert.rejects(FaceVerificationService.recordScan(
        'visitor_5', 'OUT', 0.84, new Date().toISOString(), 'CAMERA_02'
      ), /Scan already being processed/);
      assert.equal(visitorLogs.length, 1);
    } finally {
      FaceVerificationService.clearCooldowns();
      restorePrisma();
    }
  });

  it('rejects low confidence match when similarity is below threshold to prevent false identity mismatch', async () => {
    const originalFetch = globalThis.fetch;
    prisma.user.findUnique = (async ({ where }: Prisma.UserFindUniqueArgs) => {
      if (where.id === 1) {
        return {
          id: 1,
          email: 'admin@dorm.ac.th',
          username: 'admin',
          password: 'hashedpassword',
          role: 'ADMIN',
          lastLogin: null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      return null;
    }) as unknown as typeof prisma.user.findUnique;

    // External API mistakenly matches Admin with low confidence (0.61) below threshold (0.68)
    globalThis.fetch = (async () => new Response(JSON.stringify({
      matched: true,
      user_id: 1,
      similarity: 0.61,
      processing_time_ms: 35,
      message: 'Admin',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    try {
      const buffer = Buffer.from('fake-low-similarity-face');
      const result = await FaceVerificationService.verifyFace(
        buffer,
        'image/jpeg',
        'somchai-face.jpg',
        0.68
      );

      assert.equal(result.matched, false);
      assert.equal(result.user_id, null);
      assert.equal(result.similarity, 0.61);
      assert.equal(result.message, 'Face did not match registered templates');
    } finally {
      globalThis.fetch = originalFetch;
      restorePrisma();
    }
  });

  it('revokes first and retains cleanup records if Python deletion fails', async () => {
    let revoked = false;
    let removed = false;
    stub(prisma.user, 'update', async () => { revoked = true; return {}; });
    stub(prisma.user, 'findUnique', async () => ({ id: 99, faceRevokedAt: revoked ? new Date() : null }));
    stub(prisma.faceEnrollmentPhoto, 'deleteMany', async () => { removed = true; return { count: 1 }; });
    stub(globalThis, 'fetch', async () => new Response('{}', { status: 503 }));
    const result = await FaceVerificationService.deleteFaceTemplate(12);
    assert.equal(result.cleanup?.status, 'PENDING');
    assert.equal(revoked, true);
    assert.equal(removed, true);
    await assert.rejects(FaceVerificationService.recordScan('user_99', 'IN', 0.99, new Date().toISOString()), /access denied/);
  });

  it('queues and revokes atomically before removing physical files after Python confirms', async () => {
    const file = path.join('uploads', 'face-photo', `deletion-test-${randomUUID()}.jpg`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'synthetic test data');
    const actions: string[] = [];
    stub(prisma.user, 'update', async () => { actions.push('revoke'); return {}; });
    stub(globalThis, 'fetch', async (url: string, options: RequestInit) => {
      assert.ok(String(url).endsWith('/faces/owners/99'));
      assert.equal(options.method, 'DELETE');
      actions.push('python');
      return new Response(JSON.stringify({ success: true }));
    });
    stub(prisma.faceEnrollmentPhoto, 'findMany', async () => [{ id: 12, photoPath: file }]);
    stub(prisma.faceEmbedding, 'deleteMany', async () => { actions.push('vectors'); return { count: 1 }; });
    stub(prisma.faceEnrollmentPhoto, 'deleteMany', async () => {
      assert.equal(existsSync(file), true); actions.push('photos'); return { count: 1 };
    });
    try {
      assert.equal((await FaceVerificationService.deleteFaceTemplate(12)).success, true);
      assert.deepEqual(actions, ['revoke', 'vectors', 'photos', 'python']);
      assert.equal(existsSync(file), false);
    } finally { rmSync(file, { force: true }); }
  });

  it('rechecks revocation under the owner lock before committing a photo or forwarding registration', async () => {
    let reads = 0;
    stub(prisma.user, 'findUnique', async () => ({ id: 99, faceRevokedAt: ++reads === 1 ? null : new Date() }));
    const create = stub(prisma.faceEnrollmentPhoto, 'create', async () => { throw new Error('must not create'); });
    const forward = stub(globalThis, 'fetch', async () => { throw new Error('must not forward'); });
    await assert.rejects(FaceVerificationService.registerFace(99, Buffer.from('synthetic'), 'image/jpeg', 'race.jpg'), /revoked/);
    assert.equal(create.mock.callCount(), 0); assert.equal(forward.mock.callCount(), 0);
  });

  it('revoked owners cannot repopulate embeddings through Edge synchronization', async () => {
    stub(prisma.user, 'findUnique', async () => ({ id: 99, faceRevokedAt: new Date() }));
    const create = stub(prisma.faceEmbedding, 'create', async () => { throw new Error('must not create'); });
    await assert.rejects(FaceVerificationService.storeEmbeddings(99, 'v1', [[0.1]]), /revoked/);
    assert.equal(create.mock.callCount(), 0);
  });

  it('denies inactive residents and expired, cancelled, unapproved or revoked visitors', async () => {
    stub(prisma.user, 'findUnique', async () => ({ id: 99, role: 'STUDENT', tenant: { isActive: false } }));
    await assert.rejects(FaceVerificationService.recordScan('user_99', 'IN', 0.99, new Date().toISOString()), /no active room access/);
    for (const override of [
      { status: 'REGISTERED' }, { status: 'CANCELLED' }, { status: 'REJECTED' },
      { status: 'CHECKED_OUT' }, { expiresAt: new Date(0) }, { expiresAt: null },
      { faceRevokedAt: new Date() }, { expectedEntryTime: new Date(Date.now() + 60000) },
    ]) {
      stub(prisma.visitor, 'findUnique', async () => ({ id: 5, status: 'APPROVED',
        expiresAt: new Date(Date.now() + 60000), ...override }));
      await assert.rejects(FaceVerificationService.recordScan('visitor_5', 'IN', 0.99, new Date(0).toISOString()));
    }
  });

  it('does not treat an unencoded missing user as a visitor with the same ID', async () => {
    stub(prisma.user, 'findUnique', async () => null);
    const visitorLookup = stub(prisma.visitor, 'findUnique', async () => ({ id: 99 }));
    await assert.rejects(FaceVerificationService.registerFace(99, Buffer.from('test'), 'image/jpeg', 'test.jpg'), /owner not found/);
    assert.equal(visitorLookup.mock.callCount(), 0);
  });

  it('uses Bangkok day boundaries and full-day database totals rather than the latest 30 rows', async () => {
    const now = new Date('2026-10-02T17:00:00.000Z'); // Midnight on October 3 in Bangkok.
    const start = '2026-10-02T17:00:00.000Z';
    const end = '2026-10-03T17:00:00.000Z';
    const assertRange = (range: Prisma.AccessLogWhereInput['createdAt'] | Prisma.VisitorLogWhereInput['createdAt']) => {
      assert.ok(range && typeof range === 'object' && !(range instanceof Date));
      assert.equal(new Date(String(range.gte)).toISOString(), start);
      assert.equal(new Date(String(range.lt)).toISOString(), end);
    };
    stub(prisma.accessLog, 'findMany', async (args: Prisma.AccessLogFindManyArgs) => {
      assertRange(args.where?.createdAt);
      assert.equal(args.take, 30);
      return Array.from({ length: 30 }, (_, index) => ({
        id: index + 1, userId: 99, user: null, method: index === 0 ? 'MONITOR_DOOR' : 'FACE_GATE',
        path: index === 0 ? 'DOOR_CLOSE_MANUAL' : 'IN', ip: 'MAIN_GATE_01', duration: 95,
        createdAt: new Date(now.getTime() + index * 1000),
      }));
    });
    stub(prisma.visitorLog, 'findMany', async () => [{ id: 1, visitorId: 5, visitor: { guestName: 'Test visitor' },
      eventType: 'CHECK_OUT', note: 'confidence: 0.82', createdAt: new Date(now.getTime() + 60000) }]);
    stub(prisma.accessLog, 'groupBy', async (args: Prisma.AccessLogGroupByArgs) => {
      assert.equal(args.where?.method, 'FACE_GATE');
      assertRange(args.where?.createdAt);
      return [{ path: 'IN', _count: { _all: 42 } }, { path: 'OUT', _count: { _all: 11 } }];
    });
    stub(prisma.visitorLog, 'groupBy', async (args: Prisma.VisitorLogGroupByArgs) => {
      assertRange(args.where?.createdAt);
      return [{ eventType: 'CHECK_IN', _count: { _all: 3 } }, { eventType: 'CHECK_OUT', _count: { _all: 2 } }];
    });
    faceVerificationMonitoringBus.recordScan({ id: 'old-live-id', student_code: 'user_99',
      direction: 'IN', confidence: 0.95, scanned_at: now.toISOString() });
    const history = await FaceVerificationService.getMonitorHistory(now);
    assert.deepEqual(history.today_counts, { in: 45, out: 13, total: 58 });
    assert.equal(history.scans.length, 30);
    assert.equal(history.scans[0].id, 'visitor-db-1');
    assert.equal(new Set(history.scans.map(item => item.id)).size, 30);
    assert.equal(history.scans.some(item => item.id === 'old-live-id'), false);
    assert.equal(history.timezone, 'Asia/Bangkok');
    assert.equal(history.day_start, start);
    assert.equal(history.day_end, end);
    faceVerificationMonitoringBus.clearScanHistory();
  });

  it('does not count simulated door actions as check-in or check-out', async () => {
    stub(prisma.accessLog, 'findMany', async () => [{ id: 8, userId: 1, user: null,
      method: 'MONITOR_DOOR', path: 'DOOR_CLOSE_MANUAL', ip: 'MAIN_GATE_01', duration: null, createdAt: new Date() }]);
    stub(prisma.visitorLog, 'findMany', async () => []);
    stub(prisma.accessLog, 'groupBy', async () => []);
    stub(prisma.visitorLog, 'groupBy', async () => []);
    const history = await FaceVerificationService.getMonitorHistory();
    assert.deepEqual(history.today_counts, { in: 0, out: 0, total: 0 });
    assert.equal(history.scans[0].action, 'door_close_manual');
    assert.equal(history.scans[0].activity_type, 'DOOR');
  });

  it('sends open and automatic close to SSE history and Socket only after persistence', async (t) => {
    const activities: CameraScanSnapshot[] = [];
    let logId = 0;
    stub(prisma.accessLog, 'create', async () => ({ id: ++logId }));
    stub(notificationGateway, 'publishRealtimeEvent', (name: string, payload: CameraScanSnapshot) => {
      assert.equal(name, 'faceGateActivity');
      assert.equal(payload.id, `db-${logId}`);
      activities.push(payload);
    });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const device = 'AUTO_CLOSE_TEST';
    await FaceVerificationService.commandSimulatedDoor(1, device, 'unlock');
    assert.equal(activities[0].action, 'door_open_manual');
    assert.equal(activities[0].direction, 'IN');
    t.mock.timers.tick(5000);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(activities.length, 2);
    assert.equal(activities[1].action, 'door_close_auto');
    assert.equal(activities[1].direction, 'OUT');
    assert.equal(FaceVerificationService.getSimulatedDoorStatus(device), 'CLOSED');
    assert.ok(faceVerificationMonitoringBus.getScanHistory().some(item => item.id === activities[1].id && item.action === 'door_close_auto'));
  });

  it('manual close cancels the automatic close and sends one close activity', async (t) => {
    const activities: CameraScanSnapshot[] = [];
    let logId = 100;
    stub(prisma.accessLog, 'create', async () => ({ id: ++logId }));
    stub(notificationGateway, 'publishRealtimeEvent', (_name: string, payload: CameraScanSnapshot) => activities.push(payload));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const device = 'MANUAL_CLOSE_TEST';
    await FaceVerificationService.commandSimulatedDoor(1, device, 'unlock');
    await FaceVerificationService.commandSimulatedDoor(1, device, 'lock');
    t.mock.timers.tick(5000);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(activities.map(item => item.action), ['door_open_manual', 'door_close_manual']);
    assert.equal(activities[1].direction, 'OUT');
    assert.equal(FaceVerificationService.getSimulatedDoorStatus(device), 'CLOSED');
  });

  it('opens after an authorized scan and resets the five-second timer for a new accepted scan', async (t) => {
    const activities: CameraScanSnapshot[] = [];
    let logId = 200;
    stub(prisma.user, 'findUnique', async () => ({ id: 99, role: 'ADMIN', faceRevokedAt: null, tenant: null }));
    stub(prisma.accessLog, 'create', async () => ({ id: ++logId, createdAt: new Date() }));
    stub(FaceVerificationService, 'acquireCooldownLock', async () => true);
    stub(notificationGateway, 'publishRealtimeEvent', (_name: string, payload: CameraScanSnapshot) => activities.push(payload));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await FaceVerificationService.recordScan('user_99', 'IN', 0.9, new Date().toISOString(), 'MAIN_GATE_01');
    assert.equal(FaceVerificationService.getSimulatedDoorStatus('MAIN_GATE_01'), 'OPEN');
    assert.equal(activities[0].action, 'door_open_auto');
    t.mock.timers.tick(4000);
    await FaceVerificationService.recordScan('user_99', 'IN', 0.9, new Date().toISOString(), 'MAIN_GATE_01');
    t.mock.timers.tick(1000);
    assert.equal(FaceVerificationService.getSimulatedDoorStatus('MAIN_GATE_01'), 'OPEN');
    t.mock.timers.tick(4000);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(FaceVerificationService.getSimulatedDoorStatus('MAIN_GATE_01'), 'CLOSED');
    assert.deepEqual(activities.map(item => item.action), ['door_open_auto', 'door_close_auto']);
  });

  it('clears scan history from monitoring bus', () => {
    faceVerificationMonitoringBus.recordScan({
      id: 'test-scan-1',
      student_code: 'user_99',
      direction: 'IN',
      confidence: 0.95,
      scanned_at: new Date().toISOString(),
    });

    assert.ok(faceVerificationMonitoringBus.getScanHistory().length > 0);

    faceVerificationMonitoringBus.clearScanHistory();
    assert.equal(faceVerificationMonitoringBus.getScanHistory().length, 0);
  });

  it('preserves no-face and multiple-face reasons and rejects contradictory matched results', async () => {
    for (const reason of ['NO_FACE_DETECTED', 'MULTIPLE_FACES_DETECTED']) {
      stub(globalThis, 'fetch', async () => new Response(JSON.stringify({
        matched: true, user_id: 99, similarity: 0.99, reason,
      }), { status: 200 }));
      const result = await FaceVerificationService.verifyFace(Buffer.from('image'), 'image/jpeg', 'capture.jpg');
      assert.equal(result.matched, false);
      assert.equal(result.user_id, null);
      assert.equal(result.reason, reason);
      assert.equal(result.score_available, false);
    }
  });

  it('distinguishes legacy no-face, absent scores, measured zero and genuine below-threshold scores', async () => {
    const samples = [
      { payload: { matched: false, similarity: 0, bbox: null, message: 'No face detected in the image' }, available: false, reason: 'NO_FACE_DETECTED', score: 0 },
      { payload: { matched: false }, available: false, reason: 'NOT_MATCHED', score: 0 },
      { payload: { matched: false, similarity: null }, available: false, reason: 'NOT_MATCHED', score: 0 },
      { payload: { matched: false, similarity: 0 }, available: true, reason: 'NOT_MATCHED', score: 0 },
      { payload: { matched: false, similarity: 0.2624 }, available: true, reason: 'NOT_MATCHED', score: 0.2624 },
      { payload: { matched: true, user_id: 99, similarity: 0.95, face_count: 2 }, available: false, reason: 'MULTIPLE_FACES_DETECTED', score: 0 },
    ];
    for (const sample of samples) {
      stub(globalThis, 'fetch', async () => new Response(JSON.stringify(sample.payload), { status: 200 }));
      const result = await FaceVerificationService.verifyFace(Buffer.from('synthetic'), 'image/jpeg', 'capture.jpg');
      assert.equal(result.matched, false);
      assert.equal(result.score_available, sample.available);
      assert.equal(result.reason, sample.reason);
      assert.equal(result.similarity, sample.score);
    }
  });
});
