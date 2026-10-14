import assert from 'node:assert/strict';
import { it, TestContext } from 'node:test';
import express from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../../src/database/db';
import { AuthService } from '../../src/modules/auth/auth.service';
import { PrivacyConsentService, PRIVACY_NOTICES } from '../../src/modules/users/privacy-consent.service';
import { FaceVerificationService } from '../../src/modules/face-verification/face-verification.service';
import usersRoutes from '../../src/modules/users/users.routes';
import tenantsRoutes from '../../src/modules/tenants/tenants.routes';
import { errorHandler } from '../../src/middlewares/error-handler';

async function setup(t: TestContext) {
  const stub = (target: object, key: string, implementation: unknown) => {
    const original = Reflect.get(target, key);
    Reflect.set(target, key, implementation);
    t.after(() => { Reflect.set(target, key, original); });
  };
  const rows: { id: number; userId: number; method: string; path: string; createdAt: Date }[] = [];
  stub(prisma.accessLog, 'findFirst', async ({ where }: { where: { userId: number; method: string; path: string } }) =>
    rows.find(r => r.userId === where.userId && r.method === where.method && r.path === where.path) ?? null);
  stub(prisma.accessLog, 'create', async ({ data }: { data: { userId: number; method: string; path: string } }) => {
    const row = { ...data, id: rows.length + 1, createdAt: new Date() }; rows.push(row); return row;
  });
  stub(prisma, '$transaction', async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
  stub(prisma, '$queryRaw', async () => []);
  stub(AuthService, 'authenticateToken', async (token: string) => ({ id: token === 'other' ? 2 : 1, role: token === 'admin' ? Role.ADMIN : Role.STUDENT }));
  const app = express(); app.use(express.json());
  app.use('/users', usersRoutes); app.use('/tenants', tenantsRoutes); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const send = (path: string, body: unknown, token = 'student') => fetch(base + path, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { rows, base, send };
}

it('privacy notice requires the current student and never accepts consent for another account', async t => {
  const { base, send, rows } = await setup(t);
  assert.equal((await fetch(base + '/users/me/privacy-consent/HOUSING')).status, 401);
  assert.equal((await send('/users/me/privacy-consent', {}, 'admin')).status, 403);
  const input = { purpose: 'HOUSING', version: PRIVACY_NOTICES.HOUSING.version, accepted: true, userId: 999 };
  assert.equal((await send('/users/me/privacy-consent', input)).status, 200);
  assert.equal(rows[0].userId, 1);
  const own = await fetch(base + '/users/me/privacy-consent/HOUSING', { headers: { Authorization: 'Bearer student' } });
  assert.ok((await own.json()).data.acceptedAt);
  const other = await fetch(base + '/users/me/privacy-consent/HOUSING', { headers: { Authorization: 'Bearer other' } });
  assert.equal((await other.json()).data.acceptedAt, null);
});

it('false, coerced, malformed and stale consents cannot create evidence; retries reuse it', async t => {
  const { send, rows } = await setup(t);
  for (const body of [{}, { purpose: 'unknown' }, { purpose: 'HOUSING', accepted: 'true', version: PRIVACY_NOTICES.HOUSING.version },
    { purpose: 'HOUSING', accepted: false, version: PRIVACY_NOTICES.HOUSING.version }, { purpose: 'HOUSING', accepted: true, version: 'old' }]) {
    const response = await send('/users/me/privacy-consent', body);
    assert.equal(response.status, 400); assert.equal((await response.json()).success, false);
  }
  await assert.rejects(PrivacyConsentService.accept(1, null), { statusCode: 400 });
  assert.equal(rows.length, 0);
  const input = { purpose: 'HOUSING', accepted: true, version: PRIVACY_NOTICES.HOUSING.version };
  await send('/users/me/privacy-consent', input); await send('/users/me/privacy-consent', input);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].method, 'CONSENT');
});

it('housing writes and uploads reject bypasses; housing consent never authorizes biometric collection', async t => {
  const { send } = await setup(t);
  for (const route of ['/tenants/apply', '/tenants/upload-documents', '/tenants/draft/upload-identity', '/tenants/draft/upload-slip']) {
    assert.equal((await send(route, { pdpaConsent: true })).status, 403);
  }
  await send('/users/me/privacy-consent', { purpose: 'HOUSING', accepted: true, version: PRIVACY_NOTICES.HOUSING.version });
  await PrivacyConsentService.require(1, 'HOUSING');
  await assert.rejects(PrivacyConsentService.require(2, 'HOUSING'), { statusCode: 403 });
  // Stops before file writes, owner lookup or any provider request.
  await assert.rejects(FaceVerificationService.registerFace(1, Buffer.from('not-an-image'), 'image/jpeg', 'qa.jpg'), { statusCode: 403 });
  await send('/users/me/privacy-consent', { purpose: 'FACE_ENROLLMENT', accepted: true, version: PRIVACY_NOTICES.FACE_ENROLLMENT.version });
  await PrivacyConsentService.require(1, 'FACE_ENROLLMENT');
});
