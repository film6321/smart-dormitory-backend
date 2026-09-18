import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FaceVerificationService } from '../../src/modules/face-verification/face-verification.service';
import { prisma } from '../../src/database/db';

const db = prisma as any;

describe('FaceVerificationService (unit)', () => {
  // Save originals to restore
  const originalUserFindUnique = db.user.findUnique;
  const originalVisitorFindUnique = db.visitor.findUnique;
  const originalPhotoCreate = db.faceEnrollmentPhoto.create;
  const originalEmbeddingFindUnique = db.faceEmbedding.findUnique;
  const originalEmbeddingDelete = db.faceEmbedding.delete;
  const originalEmbeddingCreate = db.faceEmbedding.create;
  const originalEmbeddingFindMany = db.faceEmbedding.findMany;
  const originalPhotoFindMany = db.faceEnrollmentPhoto.findMany;
  const originalPhotoFindUnique = db.faceEnrollmentPhoto.findUnique;
  const originalAccessLogCreate = db.accessLog.create;
  const originalVisitorUpdate = db.visitor.update;
  const originalVisitorLogCreate = db.visitorLog.create;

  const restorePrisma = () => {
    db.user.findUnique = originalUserFindUnique;
    db.visitor.findUnique = originalVisitorFindUnique;
    db.faceEnrollmentPhoto.create = originalPhotoCreate;
    db.faceEmbedding.findUnique = originalEmbeddingFindUnique;
    db.faceEmbedding.delete = originalEmbeddingDelete;
    db.faceEmbedding.create = originalEmbeddingCreate;
    db.faceEmbedding.findMany = originalEmbeddingFindMany;
    db.faceEnrollmentPhoto.findMany = originalPhotoFindMany;
    db.faceEnrollmentPhoto.findUnique = originalPhotoFindUnique;
    db.accessLog.create = originalAccessLogCreate;
    db.visitor.update = originalVisitorUpdate;
    db.visitorLog.create = originalVisitorLogCreate;
  };

  it('successfully registers a face', async () => {
    db.user.findUnique = (async ({ where }: any) => {
      if (where.id === 99) return { id: 99, email: 'student@dorm.ac.th' };
      return null;
    }) as any;

    db.faceEnrollmentPhoto.create = (async ({ data }: any) => {
      return {
        id: 12,
        userId: data.userId,
        visitorId: data.visitorId,
        photoPath: data.photoPath,
        createdAt: new Date('2026-07-06T18:00:00Z'),
      };
    }) as any;

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
    db.user.findUnique = (async ({ where }: any) => {
      if (where.id === 99) return { id: 99, firstName: 'Test', lastName: 'Resident' };
      return null;
    }) as any;
    db.accessLog.create = (async () => ({})) as any;
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
    db.faceEmbedding.findUnique = (async ({ where }: any) => {
      if (where.id === 12) {
        return {
          id: 12,
          userId: 99,
          vector: [0.1, 0.2],
          modelVersion: 'buffalo_l',
          createdAt: new Date('2026-07-06T18:00:00Z'),
          updatedAt: new Date('2026-07-06T18:00:00Z'),
        };
      }
      return null;
    }) as any;

    db.user.findUnique = (async () => ({ id: 99 })) as any;
    db.faceEnrollmentPhoto.create = (async ({ data }: any) => ({
      id: 12,
      ...data,
      createdAt: new Date('2026-07-06T18:00:00Z'),
    })) as any;

    db.faceEmbedding.delete = (async () => ({})) as any;

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
    db.faceEmbedding.findMany = (async () => [
      {
        id: 1,
        userId: 99,
        visitorId: null,
        vector: [0.1, 0.2, 0.3],
        modelVersion: 'buffalo_l',
        updatedAt: new Date(),
      },
    ]) as any;

    // 2. getPendingEnrollments
    db.faceEnrollmentPhoto.findMany = (async () => [
      {
        id: 15,
        userId: 99,
        visitorId: null,
        photoPath: 'uploads/face-photo/user_99_file.jpg',
        createdAt: new Date(),
      },
    ]) as any;

    // 3. storeEmbeddings
    db.user.findUnique = (async () => ({ id: 99 })) as any;
    const createdEmbeddings: any[] = [];
    db.faceEmbedding.create = (async ({ data }: any) => {
      createdEmbeddings.push(data);
      return { id: 1, ...data };
    }) as any;

    try {
      const embs = await FaceVerificationService.getEmbeddings();
      assert.equal(embs.data.length, 1);
      assert.equal(embs.data[0].student_code, 'user_99');

      const pendings = (await FaceVerificationService.getPendingEnrollments()) as any;
      assert.equal(pendings.data.length, 1);
      assert.equal(pendings.data[0].student_id, 99);
      assert.equal(pendings.data[0].photos[0].id, 15);

      const count = await FaceVerificationService.storeEmbeddings(99, 'buffalo_l', [[0.1, 0.2, 0.3]]);
      assert.equal(count, 1);
      assert.equal(createdEmbeddings.length, 1);
      assert.equal(createdEmbeddings[0].userId, 99);
      assert.deepEqual(createdEmbeddings[0].vector, [0.1, 0.2, 0.3]);
    } finally {
      restorePrisma();
    }
  });

  it('records attendance scan for user and visitor', async () => {
    // mock user check
    db.user.findUnique = (async ({ where }: any) => {
      if (where.id === 99) return { id: 99, username: 'John Doe', tenant: { fullName: 'John Doe' } };
      return null;
    }) as any;

    const accessLogs: any[] = [];
    db.accessLog.create = (async ({ data }: any) => {
      accessLogs.push(data);
      return { id: 1, ...data };
    }) as any;

    // mock visitor check
    db.visitor.findUnique = (async ({ where }: any) => {
      if (where.id === 5) return { id: 5, guestName: 'Jane Smith', checkedInAt: null, checkedOutAt: null };
      return null;
    }) as any;

    const visitorUpdates: any[] = [];
    db.visitor.update = (async ({ where, data }: any) => {
      visitorUpdates.push({ where, data });
      return { ...where, ...data };
    }) as any;

    const visitorLogs: any[] = [];
    db.visitorLog.create = (async ({ data }: any) => {
      visitorLogs.push(data);
      return { id: 1, ...data };
    }) as any;

    try {
      const userScan = await FaceVerificationService.recordScan(
        'user_99',
        'IN',
        0.95,
        new Date().toISOString(),
        'CAMERA_01'
      );
      assert.equal(userScan.status, 'ok');
      assert.equal(userScan.action, 'checkin');
      assert.equal(userScan.student.name, 'John Doe');
      assert.equal(accessLogs.length, 1);
      assert.equal(accessLogs[0].userId, 99);
      assert.equal(accessLogs[0].path, 'IN');

      const visitorScan = await FaceVerificationService.recordScan(
        'visitor_5',
        'OUT',
        0.82,
        new Date().toISOString(),
        'CAMERA_02'
      );
      assert.equal(visitorScan.status, 'ok');
      assert.equal(visitorScan.action, 'checkout');
      assert.equal(visitorScan.student.name, 'Jane Smith');
      assert.equal(visitorUpdates.length, 1);
      assert.equal(visitorUpdates[0].data.status, 'CHECKED_OUT');
      assert.equal(visitorLogs.length, 1);
      assert.equal(visitorLogs[0].visitorId, 5);
      assert.equal(visitorLogs[0].eventType, 'CHECK_OUT');
    } finally {
      restorePrisma();
    }
  });
});
