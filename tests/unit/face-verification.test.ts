import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import { readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { FaceVerificationService } from '../../src/modules/face-verification/face-verification.service';
import { prisma } from '../../src/database/db';
import { Prisma } from '@prisma/client';
import { faceVerificationMonitoringBus } from '../../src/modules/face-verification/face-verification-monitoring';

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
    stub(prisma, '$transaction', async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
    stub(prisma, '$queryRaw', async () => []);
    stub(prisma.user, 'update', async () => ({}));
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
    await assert.rejects(FaceVerificationService.deleteFaceTemplate(12), /external deletion incomplete/);
    assert.equal(revoked, true);
    assert.equal(removed, false);
    await assert.rejects(FaceVerificationService.recordScan('user_99', 'IN', 0.99, new Date().toISOString()), /access denied/);
  });

  it('deletes physical enrollment files and both local tables after Python confirms', async () => {
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
    stub(prisma.faceEnrollmentPhoto, 'findMany', async () => [{ photoPath: file }]);
    stub(prisma.faceEmbedding, 'deleteMany', async () => { actions.push('vectors'); return { count: 1 }; });
    stub(prisma.faceEnrollmentPhoto, 'deleteMany', async () => {
      assert.equal(existsSync(file), false); actions.push('photos'); return { count: 1 };
    });
    try {
      assert.equal((await FaceVerificationService.deleteFaceTemplate(12)).success, true);
      assert.deepEqual(actions, ['revoke', 'python', 'vectors', 'photos']);
    } finally { rmSync(file, { force: true }); }
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
});
