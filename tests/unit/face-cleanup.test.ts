import type { Request, Response, NextFunction } from 'express';
import faceRoutes from '../../src/modules/face-verification/face-verification.routes';
import { verifyToken } from '../../src/middlewares/auth-jwt';
import { FaceVerificationController } from '../../src/modules/face-verification/face-verification.controller';
import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../src/database/db';
import { FaceCleanupService } from '../../src/modules/face-verification/face-cleanup.service';
import { FaceVerificationService } from '../../src/modules/face-verification/face-verification.service';
import { AccountRetentionService } from '../../src/modules/users/account-retention.service';
import { processPendingCleanup, startAccountRetentionWorker, stopAccountRetentionWorker } from '../../src/workers/accountRetentionWorker';

type Row = { id: number; key: string; category: string; value: string };
const key = 'face-cleanup:user:41';
const photo = 'uploads/face-photo/synthetic-cleanup-test.jpg';
function fixture(t: TestContext, phase = 'EXTERNAL', kind = 'user', id = 41, paths = [photo]) {
  let row: Row | null = { id: 1, key: `face-cleanup:${kind}:${id}`, category: 'FACE_CLEANUP', value: JSON.stringify({ kind, id, phase, paths, templateIds: [17] }) };
  const actions: string[] = [];
  const empty = { count: async () => 0 };
  const db = {
    systemSetting: {
      findUnique: async () => row,
      findMany: async () => row ? [row] : [],
      upsert: async (args: { create: Row; update: { value: string } }) => { actions.push('queue'); row = row ? { ...row, ...args.update } : { ...args.create, id: 1 }; return row; },
      updateMany: async (args: { where: { value: string }; data: { value: string } }) => {
        if (!row || args.where.value !== row.value) return { count: 0 };
        row = { ...row, ...args.data }; return { count: 1 };
      },
    },
    user: { update: async () => { actions.push('revoke'); return {}; } },
    visitor: { ...empty, update: async () => { actions.push('revoke'); return {}; } },
    faceEnrollmentPhoto: { ...empty, findMany: async () => [{ id: 17, photoPath: photo }], deleteMany: async () => { assert.ok(row); actions.push('photos'); return { count: 1 }; } },
    faceEmbedding: { deleteMany: async () => { assert.ok(row); actions.push('vectors'); return { count: 1 }; } },
    tenant: empty, payment: empty, paymentBatch: empty, housingRefund: empty, idCardVerification: empty, ocrJob: empty,
    $queryRaw: async () => [],
  } as unknown as typeof prisma;
  const oldKey = process.env.FACE_API_KEY;
  process.env.FACE_API_KEY = 'synthetic-test-key';
  t.after(() => { if (oldKey === undefined) delete process.env.FACE_API_KEY; else process.env.FACE_API_KEY = oldKey; });
  const calls = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ success: true })));
  t.mock.method(fs, 'realpath', async (value: string) => path.resolve(String(value)));
  t.mock.method(fs, 'lstat', async () => ({ isFile: () => true, isSymbolicLink: () => false }) as Awaited<ReturnType<typeof fs.lstat>>);
  const unlink = t.mock.method(fs, 'unlink', async () => {});
  return { db, calls, unlink, actions, row: () => row, setRow: (value: Row | null) => { row = value; } };
}
it('persists owner and all file paths before revocation and removing local biometric records', async t => {
  const f = fixture(t); f.setRow(null);
  await FaceCleanupService.enqueue(f.db, { kind: 'user', id: 41 });
  assert.deepEqual(f.actions, ['queue', 'revoke', 'vectors', 'photos']);
  assert.equal(JSON.parse(f.row()!.value).id, 41);
  assert.deepEqual(JSON.parse(f.row()!.value).paths, [photo]);
  assert.equal(f.calls.mock.callCount(), 0);
});
it('external outage remains pending across retries without deleting physical files', async t => {
  const f = fixture(t);
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 503 }));
  assert.equal((await FaceCleanupService.process(key, f.db)).status, 'PENDING');
  assert.equal(JSON.parse(f.row()!.value).phase, 'EXTERNAL');
  assert.equal(f.unlink.mock.callCount(), 0);
});
it('successful external deletion plus local files completes; repeat deletion makes no extra HTTP calls', async t => {
  const f = fixture(t);
  assert.equal((await FaceCleanupService.process(key, f.db)).status, 'COMPLETE');
  assert.equal((await FaceCleanupService.process(key, f.db)).status, 'COMPLETE');
  assert.equal(f.calls.mock.callCount(), 1); assert.equal(f.unlink.mock.callCount(), 1);
  assert.deepEqual(JSON.parse(f.row()!.value).paths, []);
  assert.equal(await FaceCleanupService.findByTemplate(17, f.db), key);
});
it('file failure resumes at FILES without calling Python again', async t => {
  const f = fixture(t);
  let fail = true;
  t.mock.method(fs, 'unlink', async () => { if (fail) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); });
  assert.equal((await FaceCleanupService.process(key, f.db)).status, 'PENDING');
  assert.equal(JSON.parse(f.row()!.value).phase, 'FILES');
  fail = false;
  assert.equal((await FaceCleanupService.process(key, f.db)).status, 'COMPLETE');
  assert.equal(f.calls.mock.callCount(), 1);
});
it('missing files are already removed but symlinks and outside paths remain pending', async t => {
  const f = fixture(t, 'FILES');
  t.mock.method(fs, 'realpath', async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); });
  assert.equal((await FaceCleanupService.process(key, f.db)).status, 'COMPLETE');
  f.setRow({ ...f.row()!, value: JSON.stringify({ kind: 'user', id: 41, phase: 'FILES', paths: ['../outside.jpg'], templateIds: [17] }) });
  assert.equal((await FaceCleanupService.process(key, f.db)).status, 'PENDING');
  assert.equal(f.unlink.mock.callCount(), 0);
});
it('shared file references prevent unlink and falsely completing cleanup', async t => {
  const f = fixture(t, 'FILES');
  t.mock.method(f.db.faceEnrollmentPhoto, 'count', async () => 1);
  assert.equal((await FaceCleanupService.process(key, f.db)).status, 'PENDING');
  assert.equal(f.unlink.mock.callCount(), 0);
});
it('visitor owner uses the external namespace and an owner mismatch never reaches HTTP', async t => {
  const f = fixture(t, 'EXTERNAL', 'visitor', 52, []);
  assert.equal((await FaceCleanupService.process('face-cleanup:visitor:52', f.db)).status, 'COMPLETE');
  assert.ok(String(f.calls.mock.calls[0].arguments[0]).endsWith('/owners/1000052'));
  await assert.rejects(FaceCleanupService.process(key, f.db), /owner mismatch/);
  assert.equal(f.calls.mock.callCount(), 1);
});
it('stale processor cannot overwrite a newer queue snapshot', async t => {
  const f = fixture(t);
  t.mock.method(globalThis, 'fetch', async () => {
    f.setRow({ ...f.row()!, value: JSON.stringify({ kind: 'user', id: 41, phase: 'EXTERNAL', paths: [photo, photo + '.new'], templateIds: [17, 18] }) });
    return new Response(JSON.stringify({ success: true }));
  });
  assert.equal((await FaceCleanupService.process(key, f.db)).status, 'PENDING');
  assert.equal(JSON.parse(f.row()!.value).paths.length, 2); assert.equal(f.unlink.mock.callCount(), 0);
});
it('retrying the same template after its metadata is gone uses the saved job', async t => {
  const f = fixture(t, 'DONE', 'user', 41, []);
  const original = prisma.faceEnrollmentPhoto.findUnique;
  prisma.faceEnrollmentPhoto.findUnique = (async () => null) as unknown as typeof original;
  t.after(() => { prisma.faceEnrollmentPhoto.findUnique = original; });
  t.mock.method(FaceCleanupService, 'findByTemplate', async (id: number) => { assert.equal(id, 17); return key; });
  t.mock.method(FaceCleanupService, 'process', async () => ({ taskKey: key, status: 'COMPLETE' }));
  assert.equal((await FaceVerificationService.deleteFaceTemplate(17)).cleanup?.status, 'COMPLETE');
  assert.equal(f.calls.mock.callCount(), 0);
});
it('private document queues contribute to the combined receipt', async t => {
  const f = fixture(t, 'DONE', 'user', 41, []);
  const fileKey = 'retention-file:' + 'a'.repeat(64);
  const get = f.db.systemSetting.findUnique;
  t.mock.method(f.db.systemSetting, 'findUnique', async (args: Parameters<typeof get>[0]) => args.where.key === fileKey ? { id: 2, key: fileKey, category: 'RETENTION_FILES', value: 'private' } as Awaited<ReturnType<typeof get>> : get(args));
  assert.equal((await FaceCleanupService.receipt([key, fileKey], f.db)).status, 'PENDING');
});
it('pending cleanup runs independently from disabled inactive-account deletion', async t => {
  const mode = process.env.ACCOUNT_RETENTION_MODE; process.env.ACCOUNT_RETENTION_MODE = 'disabled';
  const faces = t.mock.method(FaceCleanupService, 'processAll', async () => {});
  const files = t.mock.method(AccountRetentionService, 'flushFiles', async () => {});
  const retention = t.mock.method(AccountRetentionService, 'process', async () => ({ candidates: 0, eligible: 0, deleted: 0, skipped: 0 }));
  try { startAccountRetentionWorker(); await Promise.all([processPendingCleanup(), processPendingCleanup()]); await stopAccountRetentionWorker(); }
  finally { if (mode === undefined) delete process.env.ACCOUNT_RETENTION_MODE; else process.env.ACCOUNT_RETENTION_MODE = mode; }
  assert.equal(retention.mock.callCount(), 0); assert.equal(faces.mock.callCount(), 1); assert.equal(files.mock.callCount(), 1);
});

it('cleanup status endpoints require JWT and ADMIN and return no paths or vectors', async t => {
  const routes = (faceRoutes as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: Request, res: Response, next: NextFunction) => unknown }> } }> }).stack;
  for (const path of ['/cleanup', '/cleanup/:taskKey']) {
    const route = routes.find(layer => layer.route?.path === path)!.route!;
    assert.equal(route.stack[0].handle, verifyToken);
    let denial: unknown;
    route.stack[1].handle({ user: { id: 41, role: 'STUDENT' } } as unknown as Request, {} as Response, (error => { denial = error; }) as NextFunction);
    assert.equal((denial as { statusCode: number }).statusCode, 403);
    denial = undefined;
    route.stack[1].handle({ user: { id: 1, role: 'ADMIN' } } as unknown as Request, {} as Response, (error => { denial = error; }) as NextFunction);
    assert.equal(denial, undefined);
  }
  t.mock.method(FaceCleanupService, 'status', async () => ({ taskKey: key, status: 'PENDING' }));
  let body: unknown;
  const res = { status: () => res, json: (value: unknown) => { body = value; return res; } } as unknown as Response;
  await FaceVerificationController.cleanupStatus({ params: { taskKey: key } } as unknown as Request, res, (() => {}) as NextFunction);
  assert.deepEqual((body as { data: unknown }).data, { taskKey: key, status: 'PENDING' });
});
it('template deletion maps pending to 202 and complete to 200 with matching response status', async t => {
  for (const status of ['PENDING', 'COMPLETE'] as const) {
    t.mock.method(FaceVerificationService, 'deleteFaceTemplate', async () => ({ success: true, message: 'accepted', cleanup: { status, tasks: [{ taskKey: key, status }] } }));
    let code = 0; let body: unknown;
    const res = { status: (value: number) => { code = value; return res; }, json: (value: unknown) => { body = value; return res; } } as unknown as Response;
    await FaceVerificationController.deleteTemplate({ params: { templateId: '17' } } as unknown as Request, res, ((error?: unknown) => { if (error) throw error; }) as NextFunction);
    assert.equal(code, status === 'PENDING' ? 202 : 200);
    assert.equal((body as { statusCode: number }).statusCode, code);
  }
});
