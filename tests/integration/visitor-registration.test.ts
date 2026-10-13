// Opt-in HTTP/PostgreSQL/Redis test; OCR records are synthetic fixtures, not real OCR results.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { prisma } from '../../src/database/db';
import visitorRoutes from '../../src/modules/visitor/visitor.routes';
import { VisitorService } from '../../src/modules/visitor/visitor.service';
import ocrRoutes from '../../src/modules/ocr/ocr.routes';
import { OcrService } from '../../src/modules/ocr/ocr.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { errorHandler } from '../../src/middlewares/error-handler';
import { getJwtSecret } from '../../src/shared/env';
import { disconnectRedis } from '../../src/shared/redis';

const url = new URL(process.env.DATABASE_URL!);
const redisUrl = new URL(process.env.REDIS_URL!);
if (url.pathname !== '/maintenance_flow_test' || !['localhost', '127.0.0.1'].includes(url.hostname)
  || !['localhost', '127.0.0.1'].includes(redisUrl.hostname)) throw new Error('Requires isolated local database and Redis');
const roomIds: number[] = []; const verificationIds: number[] = []; const visitorIds: number[] = [];
const requestKeys: string[] = []; let adminId: number; let server: Server; let base: string; let adminCookie: string;
type Envelope = { statusCode: number; success: boolean; message: string; data: unknown };
async function request(method: string, route: string, body?: object, auth?: string, key?: string) {
  const response = await fetch(base + route, { method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Cookie: auth } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json() as Envelope;
  assert.equal(result.statusCode, response.status); assert.equal(result.success, response.ok);
  return { status: response.status, body: result };
}
const newKey = () => { const key = `visitor-integration-${randomUUID()}`; requestKeys.push(key); return key; };
async function fixture() {
  const tag = randomUUID(); const citizenId = '1234567890123';
  const room = await prisma.room.create({ data: { roomNumber: `VIS-${tag}`, monthlyRent: 100 } }); roomIds.push(room.id);
  const verification = await prisma.idCardVerification.create({ data: { imagePath: `uploads/private/id-cards/${tag}.jpg`, isThaiIdCard: true,
    fullNameTh: 'Integration Visitor', citizenIdMasked: '123********23', citizenIdHash: createHash('sha256').update(citizenId).digest('hex') } });
  verificationIds.push(verification.id);
  return { guestName: 'Integration Visitor', citizenId, address: 'Synthetic test address', roomNumber: room.roomNumber,
    requestedTenantName: 'Synthetic resident', idCardImagePath: verification.imagePath!, idCardVerificationId: verification.id, pdpaConsent: true };
}
async function register(data: object, key = newKey()) {
  const response = await request('POST', '/api/visitor/register', data, undefined, key);
  if (response.status === 201) { const id = (response.body.data as { id: number }).id; if (!visitorIds.includes(id)) visitorIds.push(id); }
  return response;
}
before(async () => {
  const admin = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, password: 'fixture', role: 'ADMIN' } });
  adminId = admin.id; adminCookie = `access_token=${jwt.sign({ id: adminId, role: 'ADMIN', sessionVersion: 1 }, getJwtSecret(), { expiresIn: '5m' })}`;
  const app = express(); app.use(express.json()); app.use('/api/visitor', visitorRoutes); app.use('/api/ocr', ocrRoutes); app.use(errorHandler);
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  try {
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.visitorLog.deleteMany({ where: { visitor: { roomId: { in: roomIds } } } });
    await prisma.visitor.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.systemSetting.deleteMany({ where: { key: { in: requestKeys.map(key => `visitor-registration:${createHash('sha256').update(key).digest('hex')}`) } } });
    await prisma.idCardVerification.deleteMany({ where: { id: { in: verificationIds } } });
    await prisma.room.deleteMany({ where: { id: { in: roomIds } } });
    if (adminId) await prisma.user.delete({ where: { id: adminId } });
  } finally { await disconnectRedis(); await prisma.$disconnect(); }
});

test('registration persists request and returns a minimal receipt without identity fields', async () => {
  const f = await fixture(); const response = await register(f); assert.equal(response.status, 201);
  const receipt = response.body.data as Record<string, unknown>; assert.equal(receipt.status, 'REGISTERED');
  for (const field of ['citizenId', 'address', 'idCardImagePath', 'qrCodeData']) assert.ok(!(field in receipt));
  const row = await prisma.visitor.findUniqueOrThrow({ where: { id: Number(receipt.id) } });
  assert.equal(receipt.createdAt, row.createdAt.toISOString());
  const settings = await SettingsService.get();
  assert.ok(Object.keys(settings.settings).every(key => !key.startsWith('visitor-registration:')));
  assert.equal(row.tenantId, null); assert.equal(row.requestedTenantName, f.requestedTenantName); assert.equal(row.qrCodeData, null);
  assert.ok(row.expiresAt); assert.ok(Math.abs(row.expiresAt.getTime() - row.createdAt.getTime() - 86400000) < 1000);
});
test('retry with the same key returns the original visitor without duplicate rows or logs', async () => {
  const f = await fixture(); const key = newKey(); const first = await register(f, key); const repeated = await register(f, key);
  assert.equal(first.status, 201); assert.equal(repeated.status, 201);
  assert.equal((first.body.data as { id: number }).id, (repeated.body.data as { id: number }).id);
  assert.equal(await prisma.visitor.count({ where: { idCardImagePath: f.idCardImagePath } }), 1);
  assert.equal(await prisma.visitorLog.count({ where: { visitorId: (first.body.data as { id: number }).id, eventType: 'REGISTERED' } }), 1);
});

test('new browser keys and a fresh OCR scan recover the same pending request', async () => {
  const f = await fixture(); const first = await register(f);
  const id = (first.body.data as { id: number }).id;
  const rescan = await prisma.idCardVerification.create({ data: { imagePath: `uploads/private/id-cards/${randomUUID()}.jpg`,
    isThaiIdCard: true, fullNameTh: f.guestName, citizenIdMasked: '123********23',
    citizenIdHash: createHash('sha256').update(f.citizenId).digest('hex') } });
  verificationIds.push(rescan.id);
  const key = newKey();
  const refreshed = await register({ ...f, idCardVerificationId: rescan.id, idCardImagePath: rescan.imagePath }, key);
  assert.equal(refreshed.status, 201); assert.equal((refreshed.body.data as { id: number }).id, id);
  assert.equal(await prisma.visitor.count({ where: { roomId: roomIds[roomIds.length - 1] } }), 1);
  assert.equal(await prisma.visitorLog.count({ where: { visitorId: id, eventType: 'REGISTERED' } }), 1);
  assert.equal((await register({ ...f, idCardVerificationId: rescan.id, idCardImagePath: rescan.imagePath }, key)).status, 201);
});

test('concurrent requests with different keys create one pending visit', async () => {
  const f = await fixture();
  const responses = await Promise.all(Array.from({ length: 3 }, () => register(f)));
  assert.ok(responses.every(response => response.status === 201));
  assert.equal(new Set(responses.map(response => (response.body.data as { id: number }).id)).size, 1);
  assert.equal(await prisma.visitor.count({ where: { idCardImagePath: f.idCardImagePath } }), 1);
});

test('new requests remain possible after cancellation or expiry', async () => {
  const f = await fixture(); const first = await register(f); const firstId = (first.body.data as { id: number }).id;
  assert.equal((await request('POST', `/api/visitor/${firstId}/cancel`, {}, adminCookie)).status, 200);
  const second = await register(f); const secondId = (second.body.data as { id: number }).id;
  assert.notEqual(secondId, firstId);
  await prisma.visitor.update({ where: { id: secondId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await VisitorService.expirePendingVisitors();
  const third = await register(f); assert.notEqual((third.body.data as { id: number }).id, secondId);
});

test('registration and evidence deletion race cannot leave a visitor without its OCR row', async () => {
  const f = await fixture();
  const [submitted, deleted] = await Promise.all([
    register(f), request('DELETE', `/api/ocr/id-card-verifications/${f.idCardVerificationId}`, undefined, adminCookie),
  ]);
  if (submitted.status === 201) {
    assert.equal(deleted.status, 409);
    assert.ok(await prisma.idCardVerification.findUnique({ where: { id: f.idCardVerificationId } }));
  } else {
    assert.ok([400, 409].includes(submitted.status)); assert.equal(deleted.status, 200);
    assert.equal(await prisma.visitor.count({ where: { idCardImagePath: f.idCardImagePath } }), 0);
  }
});

test('OCR evidence referenced by pending or cancelled visits cannot be deleted', async () => {
  const f = await fixture(); const result = await register(f); const id = (result.body.data as { id: number }).id;
  await mkdir('uploads/private/id-cards', { recursive: true });
  await writeFile(f.idCardImagePath, 'synthetic evidence');
  try {
    for (const cancelled of [false, true]) {
      if (cancelled) await request('POST', `/api/visitor/${id}/cancel`, {}, adminCookie);
      const response = await request('DELETE', `/api/ocr/id-card-verifications/${f.idCardVerificationId}`, undefined, adminCookie);
      assert.equal(response.status, 409);
      assert.ok(await prisma.idCardVerification.findUnique({ where: { id: f.idCardVerificationId } }));
      assert.ok(await prisma.visitor.findUnique({ where: { id } }));
      assert.equal(await readFile(f.idCardImagePath, 'utf8'), 'synthetic evidence');
    }
  } finally { await unlink(f.idCardImagePath); }
});

test('unused OCR evidence can still be deleted', async () => {
  const f = await fixture();
  const response = await request('DELETE', `/api/ocr/id-card-verifications/${f.idCardVerificationId}`, undefined, adminCookie);
  assert.equal(response.status, 200);
  assert.equal(await prisma.idCardVerification.count({ where: { id: f.idCardVerificationId } }), 0);
  assert.equal((await register(f)).status, 400);
});
test('a used key cannot be reused for a different request', async () => {
  const f = await fixture(); const key = newKey(); assert.equal((await register(f, key)).status, 201);
  assert.equal((await register({ ...f, requestedTenantName: 'Changed request' }, key)).status, 409);
});
test('changed middle digits are rejected even when the masked citizen ID matches', async () => {
  const f = await fixture(); assert.equal((await register({ ...f, citizenId: '1239999999923' })).status, 400);
});
test('invalid appointment time and non-finite age fail with 400', async () => {
  const f = await fixture(); assert.equal((await register({ ...f, expectedEntryTime: 'not-a-date' })).status, 400);
  assert.equal((await register({ ...f, age: 'Infinity' })).status, 400);
});
test('missing idempotency key, consent and mismatched OCR image are rejected', async () => {
  const f = await fixture(); assert.equal((await request('POST', '/api/visitor/register', f)).status, 400);
  assert.equal((await register({ ...f, pdpaConsent: false })).status, 400);
  assert.equal((await register({ ...f, idCardImagePath: 'uploads/private/id-cards/other.jpg' })).status, 400);
});
test('Admin-only detail and cancellation, repeated cancellation creates one log', async () => {
  const f = await fixture(); const result = await register(f); const id = (result.body.data as { id: number }).id;
  assert.equal((await request('GET', `/api/visitor/${id}`)).status, 401);
  assert.equal((await request('GET', `/api/visitor/${id}`, undefined, adminCookie)).status, 200);
  for (let index = 0; index < 2; index++) assert.equal((await request('POST', `/api/visitor/${id}/cancel`, { reason: 'Fixture cancel' }, adminCookie)).status, 200);
  assert.equal(await prisma.visitorLog.count({ where: { visitorId: id, eventType: 'CANCELLED' } }), 1);
});
test('expiry is persisted and logged only once', async () => {
  const f = await fixture(); const result = await register(f); const id = (result.body.data as { id: number }).id;
  await prisma.visitor.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal(await VisitorService.expirePendingVisitors(), 1); assert.equal(await VisitorService.expirePendingVisitors(), 0);
  assert.equal((await prisma.visitor.findUniqueOrThrow({ where: { id } })).status, 'EXPIRED');
  assert.equal(await prisma.visitorLog.count({ where: { visitorId: id, eventType: 'EXPIRED' } }), 1);
});


test('simultaneous requests with one key create one visitor and retries converge to it', async () => {
  const f = await fixture(); const key = newKey();
  const responses = await Promise.all(Array.from({ length: 3 }, () => register(f, key)));
  assert.ok(responses.every(result => [201, 409].includes(result.status)));
  assert.ok(responses.some(result => result.status === 201));
  const retry = await register(f, key); assert.equal(retry.status, 201);
  assert.equal(await prisma.visitor.count({ where: { idCardImagePath: f.idCardImagePath } }), 1);
  const id = (retry.body.data as { id: number }).id;
  assert.equal(await prisma.visitorLog.count({ where: { visitorId: id, eventType: 'REGISTERED' } }), 1);
});
test('verification without a full identity hash is rejected and Thai appointment retains the selected hour', async () => {
  const f = await fixture();
  await prisma.idCardVerification.update({ where: { id: f.idCardVerificationId }, data: { citizenIdHash: null } });
  assert.equal((await register(f)).status, 400);
  await prisma.idCardVerification.update({ where: { id: f.idCardVerificationId }, data: { citizenIdHash: createHash('sha256').update(f.citizenId).digest('hex') } });
  const response = await register({ ...f, expectedEntryTime: '2026-10-08T10:00:00+07:00' }); assert.equal(response.status, 201);
  const row = await prisma.visitor.findUniqueOrThrow({ where: { id: (response.body.data as { id: number }).id } });
  assert.equal(row.expectedEntryTime?.toISOString(), '2026-10-08T03:00:00.000Z');
  assert.equal((response.body.data as { expectedEntryTime: string }).expectedEntryTime, row.expectedEntryTime?.toISOString());
});

test('all protected reads and mutations reject public and Student access', async t => {
  let studentId: number | undefined; t.after(async () => { if (studentId) await prisma.user.delete({ where: { id: studentId } }); });
  const f = await fixture(); const result = await register(f);
  const id = (result.body.data as { id: number }).id;
  const student = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, password: 'QA-only', role: 'STUDENT' } });
  studentId = student.id;
  const studentCookie = `access_token=${jwt.sign({ id: student.id, role: 'STUDENT', sessionVersion: 1 }, getJwtSecret(), { expiresIn: '5m' })}`;
  const routes: Array<[string, string, object | undefined]> = [
    ['GET', '/api/visitor', undefined], ['GET', `/api/visitor/${id}`, undefined],
    ['GET', `/api/visitor/${id}/pass`, undefined],
    ['POST', `/api/visitor/${id}/cancel`, {}], ['PATCH', `/api/visitor/${id}/status`, { status: 'CANCELLED' }],
    ['POST', `/api/visitor/${id}/access`, { action: 'GRANT_ENTRY', detailsConfirmed: true }],
  ];
  for (const [method, route, body] of routes) {
    assert.equal((await request(method, route, body)).status, 401);
    assert.equal((await request(method, route, body, studentCookie)).status, 403);
  }
  assert.equal((await prisma.visitor.findUniqueOrThrow({ where: { id } })).status, 'REGISTERED');
});

test('manual entry and completion persist one event each and keep request status separate', async () => {
  const f = await fixture(); const result = await register(f); const id = (result.body.data as { id: number }).id;
  const access = (action: string) => request('POST', `/api/visitor/${id}/access`, { action, detailsConfirmed: true }, adminCookie);
  assert.equal((await access('COMPLETE_VISIT')).status, 409);
  const entries = await Promise.all([access('GRANT_ENTRY'), access('GRANT_ENTRY')]);
  assert.ok(entries.every(response => response.status === 200));
  assert.equal(await prisma.visitorLog.count({ where: { visitorId: id, eventType: 'DOOR_ACCESS_GRANTED' } }), 1);
  const log = await prisma.visitorLog.findFirstOrThrow({ where: { visitorId: id, eventType: 'DOOR_ACCESS_GRANTED' } });
  assert.ok(log.note?.includes(`UserId=${adminId}`));
  assert.equal((await request('POST', `/api/visitor/${id}/cancel`, {}, adminCookie)).status, 409);
  await prisma.visitor.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await VisitorService.expirePendingVisitors();
  const ongoing = await register(f);
  assert.equal((ongoing.body.data as { id: number }).id, id);
  const completions = await Promise.all([access('COMPLETE_VISIT'), access('COMPLETE_VISIT')]);
  assert.ok(completions.every(response => response.status === 200));
  assert.equal(await prisma.visitorLog.count({ where: { visitorId: id, eventType: 'VISIT_COMPLETED' } }), 1);
  const pass = await request('GET', `/api/visitor/${id}/pass`, undefined, adminCookie);
  assert.equal((pass.body.data as { visitStage: string }).visitStage, 'COMPLETED');
  assert.equal((pass.body.data as { canCancel: boolean }).canCancel, false);
  assert.equal((await prisma.visitor.findUniqueOrThrow({ where: { id } })).status, 'REGISTERED');
  assert.equal((await access('GRANT_ENTRY')).status, 409);
});

test('entry requires explicit confirmation and a live request', async () => {
  const f = await fixture(); const result = await register(f); const id = (result.body.data as { id: number }).id;
  for (const body of [{ action: 'GRANT_ENTRY' }, { action: 'GRANT_ENTRY', detailsConfirmed: 'true' }, { action: 'UNKNOWN', detailsConfirmed: true }]) {
    assert.equal((await request('POST', `/api/visitor/${id}/access`, body, adminCookie)).status, 400);
  }
  await prisma.visitor.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await request('POST', `/api/visitor/${id}/access`, { action: 'GRANT_ENTRY', detailsConfirmed: true }, adminCookie)).status, 409);
  await VisitorService.expirePendingVisitors();
  assert.equal(await prisma.visitorLog.count({ where: { visitorId: id, eventType: 'DOOR_ACCESS_GRANTED' } }), 0);
});

test('completed visit permits a new pending request even before registration expiry', async () => {
  const f = await fixture(); const first = await register(f); const id = (first.body.data as { id: number }).id;
  for (const action of ['GRANT_ENTRY', 'COMPLETE_VISIT']) {
    assert.equal((await request('POST', `/api/visitor/${id}/access`, { action, detailsConfirmed: true }, adminCookie)).status, 200);
  }
  const next = await register(f); assert.equal(next.status, 201); assert.notEqual((next.body.data as { id: number }).id, id);
});

test('appointments beyond the 24-hour request lifetime leave no registration', async () => {
  const f = await fixture();
  assert.equal((await register({ ...f, expectedEntryTime: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() })).status, 400);
  assert.equal(await prisma.visitor.count({ where: { idCardImagePath: f.idCardImagePath } }), 0);
});

test('Admin list/pass and cancellation status endpoint persist one terminal event', async () => {
  const f = await fixture(); const result = await register(f); const id = (result.body.data as { id: number }).id;
  const list = await request('GET', '/api/visitor', undefined, adminCookie);
  assert.equal(list.status, 200); assert.ok((list.body.data as Array<{ id: number }>).some(row => row.id === id));
  assert.equal((await request('GET', `/api/visitor/${id}/pass`, undefined, adminCookie)).status, 200);
  assert.equal((await request('PATCH', `/api/visitor/${id}/status`, { status: 'CANCELLED' }, adminCookie)).status, 200);
  const row = await prisma.visitor.findUniqueOrThrow({ where: { id } });
  assert.equal(row.status, 'CANCELLED'); assert.ok(row.cancelledAt);
  assert.equal((await request('POST', `/api/visitor/${id}/cancel`, {}, adminCookie)).status, 200);
  assert.equal(await prisma.visitorLog.count({ where: { visitorId: id, eventType: 'CANCELLED' } }), 1);
});

test('unsupported status changes and invalid IDs never mutate the request', async () => {
  const f = await fixture(); const result = await register(f); const id = (result.body.data as { id: number }).id;
  for (const status of ['VERIFYING', 'APPROVED', 'CHECKED_IN', 'CHECKED_OUT', 'REJECTED', 'EXPIRED', 'UNKNOWN']) {
    assert.equal((await request('PATCH', `/api/visitor/${id}/status`, { status }, adminCookie)).status, 409);
  }
  for (const invalidId of ['0', '-1', 'abc', '1.5']) {
    assert.equal((await request('GET', `/api/visitor/${invalidId}/pass`, undefined, adminCookie)).status, 400);
    assert.equal((await request('POST', `/api/visitor/${invalidId}/cancel`, {}, adminCookie)).status, 400);
  }
  assert.equal((await request('GET', '/api/visitor/2147483647/pass', undefined, adminCookie)).status, 404);
  assert.equal((await prisma.visitor.findUniqueOrThrow({ where: { id } })).status, 'REGISTERED');
});

test('invalid OCR identity and nonexistent rooms leave no visitor or registration metadata', async () => {
  const f = await fixture();
  for (const override of [{ guestName: 'Another identity' }, { roomNumber: 'NONEXISTENT-' + randomUUID() }, { idCardVerificationId: 2147483647 }]) {
    const key = newKey(); assert.equal((await register({ ...f, ...override }, key)).status, 400);
    assert.equal(await prisma.systemSetting.count({ where: { key: `visitor-registration:${createHash('sha256').update(key).digest('hex')}` } }), 0);
  }
  assert.equal(await prisma.visitor.count({ where: { idCardImagePath: f.idCardImagePath } }), 0);
});

test('expiry closes requests, blocks cancellation and cannot be reversed', async () => {
  const f = await fixture(); const result = await register(f); const id = (result.body.data as { id: number }).id;
  await prisma.visitor.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await request('POST', `/api/visitor/${id}/cancel`, {}, adminCookie)).status, 409);
  await VisitorService.expirePendingVisitors();
  const pass = await request('GET', `/api/visitor/${id}/pass`, undefined, adminCookie);
  assert.equal(pass.status, 200); assert.equal((pass.body.data as { isExpired: boolean }).isExpired, true);
  assert.equal((pass.body.data as { canCancel: boolean }).canCancel, false);
  assert.equal((await request('PATCH', `/api/visitor/${id}/status`, { status: 'REGISTERED' }, adminCookie)).status, 409);
  assert.equal(await prisma.visitorLog.count({ where: { visitorId: id, eventType: 'EXPIRED' } }), 1);
});

test('a persisted access event exempts a request from expiry (fixture, no door hardware)', async () => {
  const f = await fixture(); const result = await register(f); const id = (result.body.data as { id: number }).id;
  await prisma.visitor.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await prisma.visitorLog.create({ data: { visitorId: id, eventType: 'DOOR_ACCESS_GRANTED', note: 'Synthetic evidence only' } });
  await VisitorService.expirePendingVisitors();
  assert.equal((await prisma.visitor.findUniqueOrThrow({ where: { id } })).status, 'REGISTERED');
  assert.equal(await prisma.visitorLog.count({ where: { visitorId: id, eventType: 'EXPIRED' } }), 0);
});

test('OCR aliases reject missing images and unsupported file MIME before calling OCR', async () => {
  for (const route of ['/scan-id-card', '/verify-id-card', '/verify']) {
    assert.equal((await request('POST', '/api/visitor' + route, {})).status, 400);
    const data = new FormData(); data.append('file', new Blob(['invalid'], { type: 'text/plain' }), 'invalid.txt');
    const response = await fetch(base + '/api/visitor' + route, { method: 'POST', body: data });
    assert.equal(response.status, 400);
    const body = await response.json() as Envelope;
    assert.equal(body.statusCode, 400); assert.equal(body.success, false);
  }
});

test('frontend OCR endpoint returns metadata accepted by registration (mock OCR boundary)', async () => {
  const f = await fixture(); const original = OcrService.verifyIdCard;
  let receivedImage = '';
  OcrService.verifyIdCard = async image => {
    receivedImage = image;
    return { isThaiIdCard: true, verificationId: f.idCardVerificationId, imagePath: f.idCardImagePath,
      fullNameTh: f.guestName, citizenId: f.citizenId, address: f.address,
      confidence: { idDetected: true, idPresent: true, idChecksumValid: true } };
  };
  try {
    const data = new FormData(); data.append('file', new Blob(['synthetic-image'], { type: 'image/jpeg' }), 'fixture.jpg');
    const response = await fetch(base + '/api/ocr/identity-card', { method: 'POST', body: data });
    assert.equal(response.status, 200);
    assert.equal(receivedImage, `data:image/jpeg;base64,${Buffer.from('synthetic-image').toString('base64')}`);
    const envelope = await response.json() as Envelope;
    const ocr = envelope.data as { verificationId: number; imagePath: string; fullNameTh: string; citizenId: string; address: string };
    assert.equal((await register({ ...f, idCardVerificationId: ocr.verificationId, idCardImagePath: ocr.imagePath,
      guestName: ocr.fullNameTh, citizenId: ocr.citizenId, address: ocr.address })).status, 201);
  } finally { OcrService.verifyIdCard = original; }
});

test('bounded visitor write throughput counts committed requests and durable registration logs', async () => {
  // Fixture preparation is outside the measured interval. This bypasses external OCR only.
  const fixtures = await Promise.all(Array.from({ length: 12 }, () => fixture()));
  let cursor = 0;
  const statuses: number[] = [];
  const started = performance.now();
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < fixtures.length) {
      const index = cursor++;
      statuses.push((await register(fixtures[index])).status);
    }
  }));
  const seconds = (performance.now() - started) / 1000;
  const where = { idCardImagePath: { in: fixtures.map(f => f.idCardImagePath) } };
  const committed = await prisma.visitor.count({ where });
  const logs = await prisma.visitorLog.count({ where: { visitor: where, eventType: 'REGISTERED' } });
  assert.equal(statuses.filter(status => status === 201).length, 12);
  assert.equal(committed, 12); assert.equal(logs, 12);
  const runDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const directory = `tests/load/logs/${runDate}`;
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/visitor-write-result.json`, JSON.stringify({
    timestamp: new Date().toISOString(), isolatedDatabase: 'maintenance_flow_test',
    concurrency: 4, requests: 12, committed, logs, seconds, rps: 12 / seconds,
    tps: committed / seconds, status201: statuses.length,
    limitations: 'Local Express/PostgreSQL/Redis; synthetic OCR metadata; excludes gateway, real OCR, payment and sustained capacity.',
  }, null, 2));
  await writeFile(`${directory}/stats.csv`, `requests,committed,seconds,rps,tps\n12,${committed},${seconds},${12 / seconds},${committed / seconds}\n`);
  await writeFile(`${directory}/run.log`, `UserId=isolated-fixtures CorrelationId=visitor-integration database=maintenance_flow_test requests=12 committed=${committed} logs=${logs}\n`);
  await writeFile(`${directory}/final_report.md`, `# Bounded visitor write check\n\n12 synthetic registrations, concurrency 4. PostgreSQL committed ${committed} rows and ${logs} durable logs. RPS=${12 / seconds}, TPS=${committed / seconds}. Local integration check only; excludes gateway, real OCR, payment and sustained capacity. No production writes.\n`);
});
