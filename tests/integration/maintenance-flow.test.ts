import { FaceCleanupService } from '../../src/modules/face-verification/face-cleanup.service';
import { MaintenanceService } from '../../src/modules/maintenance/maintenance.service';
import { AccountRetentionService } from '../../src/modules/users/account-retention.service';
import { getContractTerms } from '../../src/modules/settings/settings.service';
import { getRedisClient, disconnectRedis } from '../../src/shared/redis';
// Run separately with DATABASE_URL pointing to maintenance_flow_test after migrate deploy.
// No application database, OCR, payment, face service or notification worker is used.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PaymentProviderClient } from '../../src/modules/billing/payment.provider';
import { OcrService } from '../../src/modules/ocr/ocr.service';
import { createHash } from 'node:crypto';
import { requiredContractFields } from '../../src/modules/tenants/tenants.dto';
import { prisma } from '../../src/database/db';
import notificationRoutes from '../../src/modules/notifications/notification.routes';
import usersRoutes from '../../src/modules/users/users.routes';
import maintenanceRoutes from '../../src/modules/maintenance/maintenance.routes';
import tenantRoutes from '../../src/modules/tenants/tenants.routes';
import billingRoutes from '../../src/modules/billing/billing.routes';
import roomsRoutes from '../../src/modules/rooms/rooms.routes';
import settingsRoutes from '../../src/modules/settings/settings.routes';
import authRoutes from '../../src/modules/auth/auth.routes';
import analyticsRoutes from '../../src/modules/analytics/analytics.routes';
import auditRoutes from '../../src/modules/audit/audit.routes';
import preferenceRoutes from '../../src/modules/notifications/notification-preferences.routes';
import { AnalyticsService } from '../../src/modules/analytics/analytics.service';
import { errorHandler } from '../../src/middlewares/error-handler';
import { getJwtSecret } from '../../src/shared/env';
import { setupSecurity } from '../../src/setup/setupSecurity';

const connection = new URL(process.env.DATABASE_URL!);
if (connection.pathname !== '/maintenance_flow_test' || !['localhost', '127.0.0.1'].includes(connection.hostname)) {
  throw new Error('Requires local isolated maintenance_flow_test database');
}
const users: number[] = [];
const tenants: number[] = [];
const rooms: number[] = [];
let server: Server;
let base: string;
let adminCookie: string;
const cookie = (id: number, role: string) => `access_token=${jwt.sign({ id, role, sessionVersion: 1 }, getJwtSecret(), { expiresIn: '5m' })}`;
type Envelope = { statusCode: number; success: boolean; message: string; data: unknown };
async function request(method: string, path: string, auth?: string, data?: object) {
  const response = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(auth ? { Cookie: auth } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await response.json() as Envelope;
  assert.equal(body.statusCode, response.status);
  assert.equal(body.success, response.ok);
  assert.ok(Object.hasOwn(body, 'data'));
  return { status: response.status, body };
}
async function fixture() {
  const tag = randomUUID();
  const user = await prisma.user.create({ data: { email: `${tag}@example.test`, password: 'not-a-login-password', role: 'STUDENT' } });
  users.push(user.id);
  const room = await prisma.room.create({ data: { roomNumber: `QA-${tag.slice(0,20)}`, monthlyRent: 100, floor: 1, capacity: 4 } });
  rooms.push(room.id);
  const tenant = await prisma.tenant.create({ data: { userId: user.id, roomId: room.id, status: 'ACTIVE', isActive: true, fullName: 'Integration fixture', checkInDate: new Date(Date.now() - 86400000) } });
  tenants.push(tenant.id);
  return { user, room, tenant, auth: cookie(user.id, 'STUDENT') };
}

test('purge removes unused QR batches for paid bills but refuses transfer evidence', async () => {
  const f = await fixture();
  const bill = await prisma.bill.create({ data: { tenantId: f.tenant.id, amount: 100, dueDate: new Date(), status: 'PAID' } });
  const batch = await prisma.paymentBatch.create({ data: {
    payerUserId: f.user.id, amount: 100, status: 'PENDING', idempotencyKey: randomUUID(),
    items: { create: { billId: bill.id, amount: 100 } },
  } });
  assert.equal((await request('PATCH', `/api/tenants/${f.tenant.id}`, adminCookie, { status: 'INACTIVE' })).status, 200);
  for (const evidence of [
    { slipHash: randomUUID() }, { slipAmount: 100 }, { providerResponse: '{}' },
    { providerTransactionId: randomUUID() }, { verifiedAt: new Date() },
  ]) {
    await prisma.paymentBatch.update({ where: { id: batch.id }, data: evidence });
    assert.equal((await request('DELETE', `/api/tenants/${f.tenant.id}`, adminCookie)).status, 409);
    assert.ok(await prisma.tenant.findUnique({ where: { id: f.tenant.id } }));
    await prisma.paymentBatch.update({ where: { id: batch.id }, data: {
      slipHash: null, slipAmount: null, providerResponse: null, providerTransactionId: null, verifiedAt: null,
    } });
  }
  await prisma.paymentBatch.update({ where: { id: batch.id }, data: { status: 'VERIFYING' } });
  assert.equal((await request('DELETE', `/api/tenants/${f.tenant.id}`, adminCookie)).status, 409);
  await prisma.paymentBatch.update({ where: { id: batch.id }, data: { status: 'PENDING' } });
  const deleted = await request('DELETE', `/api/tenants/${f.tenant.id}`, adminCookie);
  assert.ok([200, 202].includes(deleted.status));
  assert.equal(await prisma.paymentBatch.findUnique({ where: { id: batch.id } }), null);
  assert.equal(await prisma.bill.findUnique({ where: { id: bill.id } }), null);
  assert.ok(await prisma.user.findUnique({ where: { id: f.user.id } }));
});

test('notification HTTP scope excludes other users and separates admin operations', async () => {
  const first = await fixture();
  const second = await fixture();
  const ids: number[] = [];
  try {
    for (const owner of [
      { userId: first.user.id, tenantId: first.tenant.id },
      { userId: second.user.id, tenantId: second.tenant.id },
      { tenantId: first.tenant.id },
      { userId: second.user.id, tenantId: first.tenant.id },
      {},
    ]) {
      const record = await prisma.notification.create({ data: { ...owner, channel: 'SMS', type: 'GENERIC', payload: '{"message":"QA scope"}' } });
      ids.push(record.id);
    }
    assert.equal((await request('GET', '/api/notifications')).status, 401);
    const own = await request('GET', `/api/notifications?userId=${second.user.id}`, first.auth);
    assert.equal(own.status, 200);
    assert.deepEqual((own.body.data as Array<{ id: number }>).map(item => item.id).sort((a, b) => a - b), [ids[0], ids[2]]);
    const admin = await request('GET', '/api/notifications', adminCookie);
    assert.equal(admin.status, 200);
    const adminIds = (admin.body.data as Array<{ id: number }>).map(item => item.id);
    assert.equal(adminIds.includes(ids[4]!), true);
    assert.equal(adminIds.some(id => ids.slice(0, 4).includes(id)), false);
  } finally {
    await prisma.notification.deleteMany({ where: { id: { in: ids } } });
  }
});
async function create(auth: string, roomId?: number) {
  return request('POST', '/api/maintenance', auth, { category: 'OTHER', description: 'Isolated integration repair request', ...(roomId === undefined ? {} : { roomId }) });
}
before(async () => {
  for (const [key, value] of Object.entries({ contractDocLocation: 'QA Office', contractLandlordName: 'QA Landlord', contractLandlordAddress: 'QA Address', contractLandlordPhone: '0812345678', contractBuilding: 'QA Building', contractStartDate: '2026-09-01', contractEndDate: '2027-08-31', contractKeycardDeposit: '300', contractPayDueDate: '5', contractElectricityRate: '7', contractWaterRate: '18', contractAdvanceNoticeDays: '30' })) await prisma.systemSetting.upsert({ where: { key }, create: { key, value, category: 'CONTRACT' }, update: { value, category: 'CONTRACT' } });
  const admin = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, password: 'not-a-login-password', role: 'ADMIN' } });
  users.push(admin.id); adminCookie = cookie(admin.id, 'ADMIN');
  const app = express(); setupSecurity(app);
  app.use('/api/maintenance', maintenanceRoutes); app.use('/api/tenants', tenantRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/rooms', roomsRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/auth', authRoutes); app.use('/api/analytics', analyticsRoutes);
  app.use('/api/audit-logs', auditRoutes); app.use('/api/notifications/preferences', preferenceRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/billing', billingRoutes); app.use(errorHandler);
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test('room price API preserves occupied prices, locks draft prices and validates admin-only updates', async () => {
  const f = await fixture();
  assert.equal((await request('PATCH', `/api/rooms/${f.room.id}`, f.auth, { monthlyRent: 120 })).status, 403);
  assert.equal((await request('PATCH', `/api/rooms/${f.room.id}`, adminCookie, { monthlyRent: 120 })).status, 409);
  assert.equal(Number((await prisma.room.findUniqueOrThrow({ where: { id: f.room.id } })).monthlyRent), 100);
  await prisma.tenant.update({ where: { id: f.tenant.id }, data: { roomId: null, isActive: false, status: 'INACTIVE' } });
  const draft = await prisma.housingApplicationDraft.create({ data: { userId: f.user.id, roomId: f.room.id } });
  assert.equal((await request('PATCH', `/api/rooms/${f.room.id}`, adminCookie, { monthlyRent: 120 })).status, 409);
  await prisma.housingApplicationDraft.delete({ where: { id: draft.id } });
  for (const monthlyRent of [null, true, '', 'bad', -1, 0, 1.001]) {
    assert.equal((await request('PATCH', `/api/rooms/${f.room.id}`, adminCookie, { monthlyRent })).status, 400);
  }
  assert.equal((await request('PATCH', `/api/rooms/${f.room.id}`, adminCookie, { monthlyRent: 120.25 })).status, 200);
  assert.equal(Number((await prisma.room.findUniqueOrThrow({ where: { id: f.room.id } })).monthlyRent), 120.25);
});

test('daily access SQL separates Bangkok midnight and excludes heartbeat, denied scans and Admin', async () => {
  const f = await fixture();
  const adminId = users[0]!;
  await prisma.accessLog.createMany({ data: [
    { userId: f.user.id, method: 'FACE_GATE', path: 'IN', createdAt: new Date('2026-10-11T16:59:00Z') },
    { userId: f.user.id, method: 'FACE_GATE', path: 'OUT', createdAt: new Date('2026-10-11T17:01:00Z') },
    { userId: f.user.id, method: 'GET', path: '/heartbeat', createdAt: new Date('2026-10-11T17:01:00Z') },
    { userId: f.user.id, method: 'FACE_GATE', path: 'DENIED', createdAt: new Date('2026-10-11T17:01:00Z') },
    { userId: adminId, method: 'FACE_GATE', path: 'IN', createdAt: new Date('2026-10-11T17:01:00Z') },
  ] });
  const rows = await AnalyticsService.getDailyAccessAnalytics(prisma, new Date('2026-10-12T05:00:00Z'));
  assert.deepEqual(rows[28], { date: '2026-10-11', entries: 1, exits: 0 });
  assert.deepEqual(rows[29], { date: '2026-10-12', entries: 0, exits: 1 });
  await prisma.accessLog.deleteMany({ where: { userId: { in: [f.user.id, adminId] } } });
});

test('settings reject invalid types, times and empty labels before storing changes', async () => {
  for (const payload of [{ maxOccupants: 4 }, { maxOccupants: '0' }, { sessionTimeoutMinutes: '1.5' },
    { checkInTime: '25:00' }, { checkOutTime: '12:60' }, { currentTerm: '   ' }, { academicYear: '' }]) {
    assert.equal((await request('PATCH', '/api/settings', adminCookie, payload)).status, 400);
  }
});

test('academic catalogue supports admin management, active selection and safe deletion', async () => {
  const f = await fixture();
  const endpoint = '/api/settings/academics';
  assert.equal((await request('GET', endpoint)).status, 401);
  assert.equal((await request('POST', endpoint, f.auth, {})).status, 403);
  assert.equal((await request('POST', endpoint, adminCookie, { revision: '0', action: 'SAVE', kind: 'FACULTY', name: 'Invalid' })).status, 400);
  const { AcademicService } = await import('../../src/modules/settings/academic.service');
  try {
    const created = await request('POST', endpoint, adminCookie, { revision: 0, action: 'SAVE', kind: 'FACULTY', name: 'QA Faculty' });
    assert.equal(created.status, 200);
    const faculty = (created.body.data as { faculties: Array<{ id: string }> }).faculties[0]!;
    await prisma.$transaction(async tx => { assert.equal(await AcademicService.validateSelection('QA Faculty', faculty.id, tx), 'QA Faculty'); });
    await prisma.tenant.update({ where: { id: f.tenant.id }, data: { course: 'QA Faculty' } });
    assert.equal((await request('POST', endpoint, adminCookie, { revision: 1, action: 'DELETE', kind: 'FACULTY', id: faculty.id })).status, 409);
    assert.equal((await request('POST', endpoint, adminCookie, { revision: 1, action: 'SAVE', kind: 'FACULTY', id: faculty.id, name: 'Renamed faculty' })).status, 409);
    await prisma.tenant.update({ where: { id: f.tenant.id }, data: { course: null } });
    assert.equal((await request('POST', endpoint, adminCookie, { revision: 0, action: 'SAVE', kind: 'FACULTY', name: 'Stale' })).status, 409);
    const added = await request('POST', endpoint, adminCookie, { revision: 1, action: 'SAVE', kind: 'PROGRAM', facultyId: faculty.id, name: 'QA Program' });
    assert.equal(added.status, 200);
    const program = (added.body.data as { programs: Array<{ id: string }> }).programs[0]!;
    assert.equal((await request('POST', endpoint, adminCookie, { revision: 2, action: 'SAVE', kind: 'PROGRAM', facultyId: faculty.id, name: 'qa program' })).status, 409);
    assert.equal((await request('POST', endpoint, adminCookie, { revision: 2, action: 'DELETE', kind: 'FACULTY', id: faculty.id })).status, 409);
    await prisma.$transaction(async tx => {
      assert.equal(await AcademicService.validateSelection('QA Program', faculty.id, tx), 'QA Faculty');
      await assert.rejects(AcademicService.validateSelection('QA Program', 'wrong-faculty', tx), { statusCode: 400 });
    });
    await prisma.tenant.update({ where: { id: f.tenant.id }, data: { course: 'QA Program' } });
    assert.equal((await request('POST', endpoint, adminCookie, { revision: 2, action: 'DELETE', kind: 'PROGRAM', id: program.id })).status, 409);
    assert.equal((await request('POST', endpoint, adminCookie, { revision: 2, action: 'SAVE', kind: 'PROGRAM', id: program.id, facultyId: faculty.id, name: 'Renamed' })).status, 409);
    assert.equal((await request('POST', endpoint, adminCookie, { revision: 2, action: 'SAVE', kind: 'PROGRAM', id: program.id, facultyId: faculty.id, name: 'QA Program', active: false })).status, 200);
    assert.equal(((await request('GET', endpoint, f.auth)).body.data as { programs: unknown[] }).programs.length, 0);
    await prisma.$transaction(async tx => { await assert.rejects(AcademicService.validateSelection('QA Program', faculty.id, tx), { statusCode: 400 }); });
    await prisma.tenant.update({ where: { id: f.tenant.id }, data: { course: null } });
    const draft = await prisma.housingApplicationDraft.create({ data: { userId: f.user.id, data: { personalInformation: { course: 'QA Program' } } } });
    assert.equal((await request('POST', endpoint, adminCookie, { revision: 3, action: 'DELETE', kind: 'PROGRAM', id: program.id })).status, 409);
    await prisma.housingApplicationDraft.delete({ where: { id: draft.id } });
    assert.equal((await request('POST', endpoint, adminCookie, { revision: 3, action: 'DELETE', kind: 'PROGRAM', id: program.id })).status, 200);
    assert.equal((await request('POST', endpoint, adminCookie, { revision: 4, action: 'DELETE', kind: 'FACULTY', id: faculty.id })).status, 200);
  } finally {
    await prisma.housingApplicationDraft.deleteMany({ where: { userId: f.user.id } });
    await prisma.systemSetting.deleteMany({ where: { key: 'academic-catalog' } });
  }
});
after(async () => {
  try {
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.notification.deleteMany({ where: { tenantId: { in: tenants } } });
    await prisma.maintenanceTicket.deleteMany({ where: { tenantId: { in: tenants } } });
    await prisma.accessLog.deleteMany({ where: { userId: { in: users } } });
    await prisma.payment.deleteMany({ where: { payerUserId: { in: users } } });
    await prisma.paymentBatch.deleteMany({ where: { payerUserId: { in: users } } });
    await prisma.transaction.deleteMany({ where: { userId: { in: users } } });
    await prisma.idCardVerification.deleteMany({ where: { userId: { in: users } } });
    await prisma.bill.deleteMany({ where: { tenantId: { in: tenants } } });
    await prisma.systemSetting.deleteMany({ where: { key: { in: users.map(id => `face-cleanup:user:${id}`) } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
    await prisma.room.deleteMany({ where: { id: { in: rooms } } });
    await prisma.systemSetting.deleteMany({ where: { category: { in: ['CONTRACT', 'MAINTENANCE_UPLOAD'] } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    const references = await Promise.all([
      prisma.tenant.count(), prisma.payment.count(), prisma.paymentBatch.count(),
      prisma.idCardVerification.count(), prisma.ocrJob.count(), prisma.visitor.count(),
      prisma.faceEnrollmentPhoto.count(), prisma.maintenanceTicket.count(),
    ]);
    if (references.every(count => count === 0)) {
      const missing: number[] = [];
      for (const row of await prisma.systemSetting.findMany({ where: { category: 'RETENTION_FILES' } })) {
        try { await fs.stat(row.value); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') missing.push(row.id); else throw error; }
      }
      await prisma.systemSetting.deleteMany({ where: { category: 'RETENTION_FILES', id: { in: missing } } });
    }
  } finally { await disconnectRedis(); await prisma.$disconnect(); }
});

test('HTTP lifecycle persists all repair states and rejects changes after resolution', async () => {
  const f = await fixture(); const created = await create(f.auth);
  assert.equal(created.status, 201);
  const id = (created.body.data as { id: number }).id;
  assert.equal((await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id } })).roomId, f.room.id);
  assert.equal(await prisma.notification.count({ where: { tenantId: f.tenant.id, payload: { contains: `Maintenance ticket ${id} created` } } }), 1);
  for (const state of ['APPROVED', 'IN_PROGRESS', 'RESOLVED']) {
    assert.equal((await request('PATCH', `/api/maintenance/${id}/status`, adminCookie, { status: state })).status, 200);
    assert.equal((await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id } })).status, state);
  }
  assert.equal((await request('PATCH', `/api/maintenance/${id}/status`, adminCookie, { status: 'CANCELLED' })).status, 409);
  assert.equal((await request('DELETE', `/api/maintenance/${id}`, adminCookie)).status, 409);
  assert.equal((await request('PATCH', `/api/maintenance/${id}/status`, adminCookie, { status: 'CLOSED' })).status, 200);
  assert.equal((await request('DELETE', `/api/maintenance/${id}`, adminCookie)).status, 409);
  const listed = await request('GET', '/api/maintenance', f.auth);
  assert.ok((listed.body.data as Array<{ id: number; status: string }>).some(row => row.id === id && row.status === 'CLOSED'));
});

test('four simultaneous submissions create exactly three tickets and durable quota records', async () => {
  const f = await fixture();
  const results = await Promise.all(Array.from({ length: 4 }, () => create(f.auth)));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 201, 201, 429]);
  assert.equal(await prisma.maintenanceTicket.count({ where: { tenantId: f.tenant.id } }), 3);
  assert.equal(await prisma.accessLog.count({ where: { userId: f.user.id, method: 'MAINTENANCE_CREATED' } }), 3);
  const ticket = await prisma.maintenanceTicket.findFirstOrThrow({ where: { tenantId: f.tenant.id } });
  assert.equal((await request('DELETE', `/api/maintenance/${ticket.id}`, adminCookie)).status, 200);
  assert.equal((await create(f.auth)).status, 429);
});

test('resident confirms only an owned resolved repair and simultaneous confirmations are safe', async () => {
  const f = await fixture(); const other = await fixture();
  const created = await create(f.auth); const id = (created.body.data as { id: number }).id;
  const endpoint = `/api/maintenance/${id}/confirm`;
  assert.equal((await request('POST', endpoint, undefined, { confirmed: true })).status, 401);
  assert.equal((await request('POST', endpoint, adminCookie, { confirmed: true })).status, 403);
  assert.equal((await request('POST', endpoint, other.auth, { confirmed: true })).status, 404);
  for (const body of [{}, { confirmed: false }, { confirmed: 'true' }, { confirmed: true, userId: f.user.id }]) {
    assert.equal((await request('POST', endpoint, f.auth, body)).status, 400);
  }
  assert.equal((await request('POST', endpoint, f.auth, { confirmed: true })).status, 409);
  for (const status of ['APPROVED', 'IN_PROGRESS', 'RESOLVED']) {
    assert.equal((await request('PATCH', `/api/maintenance/${id}/status`, adminCookie, { status })).status, 200);
  }
  const results = await Promise.all(Array.from({ length: 3 }, () => request('POST', endpoint, f.auth, { confirmed: true })));
  assert.ok(results.every(result => result.status === 200));
  assert.equal((await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id } })).status, 'CLOSED');
  assert.equal((await request('PATCH', `/api/maintenance/${id}/status`, f.auth, { status: 'APPROVED' })).status, 403);
  assert.equal((await request('POST', '/api/maintenance/0/confirm', f.auth, { confirmed: true })).status, 400);
});

test('write-time transition guard rejects a skipped repair stage', async () => {
  const f = await fixture(); const created = await create(f.auth);
  const id = (created.body.data as { id: number }).id;
  const { MaintenanceRepository } = await import('../../src/modules/maintenance/maintenance.repository');
  await assert.rejects(MaintenanceRepository.updateTicketStatus(id, { status: 'RESOLVED' }), { code: 'P2025' });
  await assert.rejects(MaintenanceRepository.updateTicketStatus(id, { status: 'CLOSED' }), { code: 'P2025' });
  assert.equal((await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id } })).status, 'PENDING');
});

test('quota becomes available on the next Thai calendar day', async () => {
  const f = await fixture();
  for (let index = 0; index < 3; index++) assert.equal((await create(f.auth)).status, 201);
  const yesterday = new Date(Date.now() - 86400000);
  await prisma.$transaction([
    prisma.maintenanceTicket.updateMany({ where: { tenantId: f.tenant.id }, data: { createdAt: yesterday } }),
    prisma.accessLog.updateMany({ where: { userId: f.user.id, method: 'MAINTENANCE_CREATED' }, data: { createdAt: yesterday } }),
  ]);
  assert.equal((await create(f.auth)).status, 201);
});

test('room ownership and invalid input fail before consuming quota', async () => {
  const f = await fixture(); const other = await fixture();
  assert.equal((await create(f.auth, other.room.id)).status, 403);
  assert.equal((await request('POST', '/api/maintenance', f.auth, { category: 'OTHER', description: 'Valid repair description', contactTime: 'invalid-date' })).status, 400);
  assert.equal(await prisma.maintenanceTicket.count({ where: { tenantId: f.tenant.id } }), 0);
  assert.equal(await prisma.accessLog.count({ where: { userId: f.user.id, method: 'MAINTENANCE_CREATED' } }), 0);
});

test('Student cannot read another tenant tickets or manage ticket status', async () => {
  const f = await fixture(); const other = await fixture();
  const result = await create(other.auth); const id = (result.body.data as { id: number }).id;
  const own = await request('GET', '/api/maintenance', f.auth);
  assert.equal((own.body.data as unknown[]).length, 0);
  assert.equal((await request('PATCH', `/api/maintenance/${id}/status`, f.auth, { status: 'APPROVED' })).status, 403);
  assert.equal((await request('DELETE', `/api/maintenance/${id}`, f.auth)).status, 403);
  assert.equal((await request('GET', '/api/maintenance')).status, 401);
});

test('move-out releases the room, blocks repair submission and cannot reopen the old stay', async () => {
  const f = await fixture();
  const response = await request('PATCH', `/api/tenants/${f.tenant.id}`, adminCookie, { status: 'INACTIVE' });
  assert.equal(response.status, 200);
  const moved = await prisma.tenant.findUniqueOrThrow({ where: { id: f.tenant.id } });
  assert.equal(moved.roomId, null); assert.equal(moved.isActive, false); assert.ok(moved.checkOutDate);
  assert.equal((await prisma.room.findUniqueOrThrow({ where: { id: f.room.id } })).status, 'AVAILABLE');
  assert.equal((await create(f.auth)).status, 403);
  assert.equal((await request('PATCH', `/api/tenants/${f.tenant.id}`, adminCookie, { status: 'ACTIVE' })).status, 409);
});

test('unpaid bill prevents move-out and leaves the stay unchanged', async () => {
  const f = await fixture();
  await prisma.bill.create({ data: { tenantId: f.tenant.id, amount: 100, dueDate: new Date(), status: 'UNPAID' } });
  assert.equal((await request('PATCH', `/api/tenants/${f.tenant.id}`, adminCookie, { status: 'INACTIVE' })).status, 409);
  const stored = await prisma.tenant.findUniqueOrThrow({ where: { id: f.tenant.id } });
  assert.equal(stored.status, 'ACTIVE'); assert.equal(stored.roomId, f.room.id);
});


test('active stay and unfinished repair block deletion; closed repair is purged after move-out', async () => {
  const f = await fixture();
  const oldDraft = await prisma.housingApplicationDraft.create({ data: { userId: f.user.id, roomId: f.room.id, status: 'SUBMITTED', data: { activeStep: 3, personalInformation: { firstName: 'Previous application' } } } });
  const result = await create(f.auth); const id = (result.body.data as { id: number }).id;
  assert.equal((await request('DELETE', `/api/tenants/${f.tenant.id}`, adminCookie)).status, 409);
  assert.equal((await request('PATCH', `/api/tenants/${f.tenant.id}`, adminCookie, { status: 'INACTIVE' })).status, 200);
  assert.equal((await request('DELETE', `/api/tenants/${f.tenant.id}`, adminCookie)).status, 409);
  assert.equal((await prisma.tenant.findUniqueOrThrow({ where: { id: f.tenant.id } })).userId, f.user.id);
  for (const state of ['APPROVED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) {
    assert.equal((await request('PATCH', `/api/maintenance/${id}/status`, adminCookie, { status: state })).status, 200);
  }
  const deleted = await request('DELETE', `/api/tenants/${f.tenant.id}`, adminCookie);
  assert.ok([200, 202].includes(deleted.status));
  assert.equal(await prisma.tenant.findUnique({ where: { id: f.tenant.id } }), null);
  assert.equal(await prisma.maintenanceTicket.count({ where: { tenantId: f.tenant.id } }), 0);
  assert.ok(await prisma.user.findUnique({ where: { id: f.user.id } }));
  assert.equal((await request('GET', '/api/tenants/me', f.auth)).body.data, null);
  assert.equal(await prisma.housingApplicationDraft.findUnique({ where: { id: oldDraft.id } }), null);
  const freshResponse = await request('GET', '/api/tenants/draft', f.auth);
  assert.equal(freshResponse.status, 200);
  const fresh = freshResponse.body.data as { id: number; version: number; status: string; roomNumber: string; paidAmount: number; data: Record<string, unknown> };
  assert.notEqual(fresh.id, oldDraft.id);
  assert.equal(fresh.status, 'OPEN');
  assert.equal(fresh.roomNumber, '');
  assert.equal(fresh.paidAmount, 0);
  assert.deepEqual(fresh.data, {});
  const saved = await request('PATCH', '/api/tenants/draft', f.auth, { version: fresh.version, roomNumber: f.room.roomNumber, data: { activeStep: 0, personalInformation: { firstName: 'New application' } } });
  assert.equal(saved.status, 200);
  const stored = await prisma.housingApplicationDraft.findUniqueOrThrow({ where: { userId: f.user.id } });
  assert.equal(stored.roomId, f.room.id);
  assert.deepEqual(stored.data, { activeStep: 0, personalInformation: { firstName: 'New application' } });
});

test('settled synthetic bills and their owner profile are physically deleted while the account remains', async () => {
  // PAID is fixture data only: no payment provider, transfer or slip verification is performed.
  const f = await fixture();
  const bill = await prisma.bill.create({ data: { tenantId: f.tenant.id, amount: 100, dueDate: new Date(), status: 'PAID', description: 'Fixture personal bill note', reason: 'Fixture personal reason' } });
  assert.equal((await request('PATCH', `/api/tenants/${f.tenant.id}`, adminCookie, { status: 'INACTIVE' })).status, 200);
  const result = await request('DELETE', `/api/tenants/${f.tenant.id}`, adminCookie);
  assert.ok([200, 202].includes(result.status));
  assert.equal(await prisma.bill.findUnique({ where: { id: bill.id } }), null);
  assert.equal(await prisma.tenant.findUnique({ where: { id: f.tenant.id } }), null);
  assert.ok(await prisma.user.findUnique({ where: { id: f.user.id } }));
});

test('paid payments, batches and deposit disappear together and OCR cache is invalidated', async () => {
  const f = await fixture(); const other = await fixture();
  const bill = await prisma.bill.create({ data: { tenantId: f.tenant.id, amount: 100, dueDate: new Date(), status: 'PAID' } });
  await prisma.payment.create({ data: { billId: bill.id, payerUserId: f.user.id, amount: 100, status: 'PAID', idempotencyKey: randomUUID() } });
  const verification = await prisma.idCardVerification.create({ data: { userId: f.user.id, isThaiIdCard: true } });
  await prisma.payment.create({ data: { housingTenantId: f.tenant.id, housingRoomId: f.room.id, housingVerificationId: verification.id, payerUserId: f.user.id, amount: 300, status: 'PAID', idempotencyKey: randomUUID() } });
  await prisma.transaction.create({ data: { userId: f.user.id, amount: 300, type: 'INCOME' } });
  const batch = await prisma.paymentBatch.create({ data: { payerUserId: f.user.id, amount: 100, status: 'PAID', idempotencyKey: randomUUID(), items: { create: { billId: bill.id, amount: 100 } } } });
  const cacheKey = 'cache:ocr:id-card-verifications:integration-delete';
  await getRedisClient().set(cacheKey, JSON.stringify({ userId: f.user.id }), 'EX', 30);
  assert.equal((await request('PATCH', `/api/tenants/${f.tenant.id}`, adminCookie, { status: 'INACTIVE' })).status, 200);
  assert.ok([200, 202].includes((await request('DELETE', `/api/tenants/${f.tenant.id}`, adminCookie)).status));
  assert.equal(await prisma.payment.count({ where: { payerUserId: f.user.id } }), 0);
  assert.equal(await prisma.transaction.count({ where: { userId: f.user.id } }), 0);
  assert.equal(await prisma.idCardVerification.findUnique({ where: { id: verification.id } }), null);
  assert.equal(await prisma.paymentBatch.findUnique({ where: { id: batch.id } }), null);
  assert.equal(await prisma.paymentBatchItem.count({ where: { batchId: batch.id } }), 0);
  assert.equal(await prisma.bill.findUnique({ where: { id: bill.id } }), null);
  assert.equal(await prisma.tenant.findUnique({ where: { id: f.tenant.id } }), null);
  assert.equal(await getRedisClient().exists(cacheKey), 0);
  assert.ok(await prisma.user.findUnique({ where: { id: f.user.id } }));
  assert.ok(await prisma.tenant.findUnique({ where: { id: other.tenant.id } }));
  assert.equal((await request('DELETE', `/api/tenants/${f.tenant.id}`, adminCookie)).status, 404);
});

test('a paid batch shared with another resident blocks deletion without partial changes', async () => {
  const f = await fixture(); const other = await fixture();
  const bill = await prisma.bill.create({ data: { tenantId: f.tenant.id, amount: 100, dueDate: new Date(), status: 'PAID' } });
  const otherBill = await prisma.bill.create({ data: { tenantId: other.tenant.id, amount: 100, dueDate: new Date(), status: 'PAID' } });
  const batch = await prisma.paymentBatch.create({ data: { payerUserId: f.user.id, amount: 200, status: 'PAID', idempotencyKey: randomUUID(), items: { create: [{ billId: bill.id, amount: 100 }, { billId: otherBill.id, amount: 100 }] } } });
  await prisma.tenant.update({ where: { id: f.tenant.id }, data: { status: 'INACTIVE', isActive: false, roomId: null } });
  assert.equal((await request('DELETE', `/api/tenants/${f.tenant.id}`, adminCookie)).status, 409);
  assert.ok(await prisma.tenant.findUnique({ where: { id: f.tenant.id } }));
  assert.ok(await prisma.bill.findUnique({ where: { id: bill.id } }));
  assert.equal(await prisma.paymentBatchItem.count({ where: { batchId: batch.id } }), 2);
});

test('an anonymous archived owner can be cleared while its former user remains', async () => {
  const f = await fixture();
  await prisma.tenant.update({ where: { id: f.tenant.id }, data: { status: 'ARCHIVED', roomId: null, userId: null, isActive: false } });
  const bill = await prisma.bill.create({ data: { tenantId: f.tenant.id, amount: 100, dueDate: new Date(), status: 'PAID' } });
  assert.ok([200, 202].includes((await request('DELETE', `/api/tenants/${f.tenant.id}`, adminCookie)).status));
  assert.equal(await prisma.tenant.findUnique({ where: { id: f.tenant.id } }), null);
  assert.equal(await prisma.bill.findUnique({ where: { id: bill.id } }), null);
  assert.ok(await prisma.user.findUnique({ where: { id: f.user.id } }));
});

test('untrusted CORS origin returns a 403 envelope without allowing the origin', async () => {
  const response = await fetch(base + '/api/tenants', { headers: { Origin: 'https://untrusted.example.test', Cookie: adminCookie } });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const body = await response.json() as Envelope;
  assert.equal(body.statusCode, 403); assert.equal(body.success, false); assert.equal(body.data, null);
});

test('Admin activation enables own resident and repair flows, confirms deposit once and preserves authorization', async () => {
  const f = await fixture(); const other = await fixture();
  await prisma.tenant.update({ where: { id: f.tenant.id }, data: { status: 'PENDING' } });
  const verification = await prisma.idCardVerification.create({ data: { userId: f.user.id, isThaiIdCard: true } });
  const deposit = await prisma.payment.create({ data: {
    housingTenantId: f.tenant.id, housingRoomId: f.room.id, housingVerificationId: verification.id,
    payerUserId: f.user.id, amount: 300, status: 'PAID', idempotencyKey: randomUUID(),
  } });
  assert.equal((await create(f.auth)).status, 403);
  assert.equal((await request('PATCH', `/api/tenants/${f.tenant.id}`, f.auth, { status: 'ACTIVE' })).status, 403);
  assert.equal((await request('PATCH', `/api/tenants/${f.tenant.id}`, adminCookie, { status: 'ACTIVE' })).status, 200);
  const current = (await request('GET', '/api/tenants/me', f.auth)).body.data as { id: number; status: string; roomId: number };
  assert.equal(current.id, f.tenant.id); assert.equal(current.status, 'ACTIVE'); assert.equal(current.roomId, f.room.id);
  assert.equal((await prisma.tenant.findUniqueOrThrow({ where: { id: f.tenant.id } })).isActive, true);
  const approvedAt = (await prisma.payment.findUniqueOrThrow({ where: { id: deposit.id } })).housingApprovedAt;
  assert.ok(approvedAt);
  assert.equal((await request('PATCH', `/api/tenants/${f.tenant.id}`, adminCookie, { status: 'ACTIVE' })).status, 200);
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: deposit.id } })).housingApprovedAt?.getTime(), approvedAt.getTime());
  assert.equal((await request('GET', `/api/tenants/${f.tenant.id}`, other.auth)).status, 403);
  assert.equal((await create(f.auth)).status, 201);
  assert.equal((await create(f.auth, other.room.id)).status, 403);
  assert.equal((await request('DELETE', `/api/tenants/${f.tenant.id}`, adminCookie)).status, 409);
});

test('ACTIVE resident receives the generated room bill and another resident cannot see or pay it', async () => {
  const f = await fixture(); const other = await fixture();
  const roomNumber = f.room.roomNumber.toUpperCase();
  await prisma.room.update({ where: { id: f.room.id }, data: { roomNumber } });
  const input = { roomNumber, electricUnits: 2, waterAmount: 100, customRent: 100, billingMonth: '2026-10', dueDate: new Date(Date.now() + 86400000).toISOString() };
  assert.equal((await request('POST', '/api/billing/generate-room-bill', f.auth, input)).status, 403);
  assert.equal((await request('POST', '/api/billing/generate-room-bill', adminCookie, input)).status, 201);
  const bill = await prisma.bill.findFirstOrThrow({ where: { tenantId: f.tenant.id } });
  assert.equal(Number(bill.amount), 216); assert.equal(bill.status, 'UNPAID'); assert.equal(bill.roomId, f.room.id);
  const own = (await request('GET', '/api/billing', f.auth)).body.data as Array<{ id: number }>;
  const others = (await request('GET', '/api/billing', other.auth)).body.data as Array<{ id: number }>;
  assert.ok(own.some(row => row.id === bill.id)); assert.ok(!others.some(row => row.id === bill.id));
  // Rejected before calling the external payment provider.
  assert.equal((await request('GET', `/api/billing/${bill.id}/payment-qr`, other.auth)).status, 403);
  assert.equal((await request('PATCH', `/api/tenants/${f.tenant.id}`, adminCookie, { status: 'INACTIVE' })).status, 409);
  assert.equal((await prisma.tenant.findUniqueOrThrow({ where: { id: f.tenant.id } })).status, 'ACTIVE');
});


test('draft endpoint restores room and form, isolates owners, rejects stale writes and blocks pending payment changes', async () => {
  const f = await fixture(); const other = await fixture();
  await prisma.tenant.delete({ where: { id: f.tenant.id } });
  const restored = await request('GET', '/api/tenants/draft', f.auth);
  const draft = restored.body.data as { id: number; version: number };
  assert.equal((await request('GET', '/api/tenants/draft')).status, 401);
  const update = { version: draft.version, roomNumber: f.room.roomNumber,
    data: { activeStep: 2, personalInformation: { firstName: 'Test', studentId: '123' }, paidAmount: 999999 } };
  assert.equal((await request('PATCH', '/api/tenants/draft', f.auth, update)).status, 200);
  assert.equal((await request('PATCH', '/api/tenants/draft', f.auth, update)).status, 409);
  const after = (await request('GET', '/api/tenants/draft', f.auth)).body.data as { roomNumber: string; paidAmount: number; data: Record<string, unknown>; version: number };
  assert.equal(after.roomNumber, f.room.roomNumber); assert.equal(after.paidAmount, 0);
  assert.equal(after.data.paidAmount, undefined); assert.equal(after.data.activeStep, 2);
  assert.deepEqual(after.data.personalInformation, { firstName: 'Test', studentId: '123' });
  assert.notEqual(((await request('GET', '/api/tenants/draft', other.auth)).body.data as { id: number }).id, draft.id);
  const pendingIdentity = await prisma.idCardVerification.create({ data: { userId: f.user.id, isThaiIdCard: true, idDetected: true } });
  await prisma.payment.create({ data: { payerUserId: f.user.id, housingDraftId: draft.id, housingRoomId: f.room.id, housingVerificationId: pendingIdentity.id,
    amount: 100, status: 'MANUAL_REVIEW', idempotencyKey: randomUUID() } });
  const blocked = await request('PATCH', '/api/tenants/draft', f.auth, { ...update, version: after.version, roomNumber: other.room.roomNumber });
  assert.equal(blocked.status, 409);
  assert.equal((await request('GET', `/api/tenants/draft/payment-qr/${f.room.roomNumber}`, f.auth)).status, 409);
  assert.equal((await prisma.housingApplicationDraft.findUniqueOrThrow({ where: { userId: f.user.id } })).roomId, f.room.id);
});

test('verified room credit survives reload, pays only upgrade difference, consumes all transfers once and purges with tenant', async t => {
  // Synthetic transfers and images in the isolated database; no external money or OCR is used.
  const f = await fixture(); const air = await fixture();
  await prisma.tenant.delete({ where: { id: f.tenant.id } });
  await prisma.user.update({ where: { id: f.user.id }, data: { phone: '0812345678' } });
  await prisma.room.update({ where: { id: air.room.id }, data: { monthlyRent: 200 } });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draft-credit-'));
  const originalRoot = process.env.UPLOAD_ROOT; process.env.UPLOAD_ROOT = root;
  t.after(async () => {
    if (originalRoot === undefined) delete process.env.UPLOAD_ROOT; else process.env.UPLOAD_ROOT = originalRoot;
    if (path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('draft-credit-')) await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, 'id-cards')); await fs.writeFile(path.join(root, 'id-cards/fixture.png'), 'synthetic image');
  let verification = await prisma.idCardVerification.create({ data: { userId: f.user.id, idDetected: true, isThaiIdCard: true,
    imagePath: 'uploads/private/id-cards/fixture.png', fullNameTh: 'ผู้สมัคร ทดสอบ' } });
  const firstDraft = (await request('GET', '/api/tenants/draft', f.auth)).body.data as { id: number; version: number };
  let saved = (await request('PATCH', '/api/tenants/draft', f.auth, { version: firstDraft.version, roomNumber: f.room.roomNumber, data: { activeStep: 2 } })).body.data as { version: number };
  let providerCalls = 0;
  const provider = t.mock.method(PaymentProviderClient, 'verifySlip', async () => ({ success: true, recipientMatched: true,
    duplicate: false, retryable: ++providerCalls === 1, amount: 100, transactionId: randomUUID(), rawData: {} }));
  const upload = async () => {
    const form = new FormData(); form.set('roomNumber', air.room.roomNumber); form.set('verificationId', String(verification.id));
    form.set('paymentSlip', new Blob([randomUUID()], { type: 'image/png' }), 'fixture.png');
    const response = await fetch(base + '/api/tenants/draft/upload-slip', { method: 'POST', headers: { Cookie: f.auth }, body: form });
    return { status: response.status, body: await response.json() as Envelope };
  };
  // First transfer in the original room.
  const { HousingPaymentService } = await import('../../src/modules/tenants/housing-payment.service');
  const initialSlip = { mimetype: 'image/png', buffer: Buffer.from(randomUUID()), originalname: 'fixture.png' };
  await assert.rejects(HousingPaymentService.verifyDraftSlip(f.room.roomNumber, f.user.id, initialSlip, verification.id));
  const waiting = (await request('GET', '/api/tenants/draft', f.auth)).body.data as { pending: boolean; canRetrySlip: boolean };
  assert.equal(waiting.pending, true); assert.equal(waiting.canRetrySlip, true);
  assert.equal((await request('GET', `/api/tenants/draft/payment-qr/${f.room.roomNumber}`, f.auth)).status, 409);
  assert.equal((await request('PATCH', '/api/tenants/draft', f.auth, { version: saved.version, roomNumber: air.room.roomNumber, data: {} })).status, 409);
  await prisma.payment.updateMany({ where: { housingDraftId: firstDraft.id, failureReason: 'PROVIDER_PENDING' }, data: { updatedAt: new Date(Date.now() - 6 * 60 * 1000) } });
  const original = await HousingPaymentService.verifyDraftSlip(f.room.roomNumber, f.user.id, initialSlip, verification.id);
  saved = (await request('PATCH', '/api/tenants/draft', f.auth, { version: saved.version, roomNumber: air.room.roomNumber, data: { activeStep: 2 } })).body.data as { version: number };
  const reload = (await request('GET', '/api/tenants/draft', f.auth)).body.data as { paidAmount: number; remainingAmount: number; roomNumber: string };
  assert.equal(reload.paidAmount, 100); assert.equal(reload.remainingAmount, 100); assert.equal(reload.roomNumber, air.room.roomNumber);
  const qr = t.mock.method(PaymentProviderClient, 'generateQr', async (amount: number) => {
    assert.equal(amount, 100); return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  });
  assert.equal((await request('GET', `/api/tenants/draft/payment-qr/${air.room.roomNumber}`, f.auth)).status, 200);
  assert.equal(qr.mock.callCount(), 1);
  const topup = await upload(); assert.equal(topup.status, 200);
  const payment = (topup.body.data as { paymentVerification: { id: number }; paymentSlipPath: string });
  const complete = (await request('GET', '/api/tenants/draft', f.auth)).body.data as { ready: boolean; paidAmount: number; remainingAmount: number };
  assert.equal(complete.ready, true); assert.equal(complete.paidAmount, 200); assert.equal(complete.remainingAmount, 0);
  assert.equal((await upload()).status, 409); assert.equal(provider.mock.callCount(), 3);
  assert.equal((await request('GET', `/api/tenants/draft/payment-qr/${air.room.roomNumber}`, f.auth)).status, 409);
  const cheaper = (await request('PATCH', '/api/tenants/draft', f.auth, { version: saved.version, roomNumber: f.room.roomNumber, data: { activeStep: 2 } })).body.data as { excessAmount: number; ready: boolean; version: number };
  assert.equal(cheaper.excessAmount, 100); assert.equal(cheaper.ready, false);
  assert.equal((await request('GET', `/api/tenants/draft/payment-qr/${f.room.roomNumber}`, f.auth)).status, 409);
  saved = (await request('PATCH', '/api/tenants/draft', f.auth, { version: cheaper.version, roomNumber: air.room.roomNumber, data: { activeStep: 2 } })).body.data as { version: number };
  const stored = await prisma.payment.findUniqueOrThrow({ where: { id: original.id } });
  assert.equal(stored.housingRoomId, f.room.id); assert.equal(Number(stored.amount), 100);
  const hash = createHash('sha256').update('1234567890123').digest('hex');
  await prisma.idCardVerification.update({ where: { id: verification.id }, data: { citizenIdHash: hash, idChecksumValid: true } });
  const newIdentity = await prisma.idCardVerification.create({ data: { userId: f.user.id, idDetected: true, isThaiIdCard: true,
    imagePath: verification.imagePath, fullNameTh: verification.fullNameTh, citizenIdHash: hash, idChecksumValid: true } });
  const wrongIdentity = await prisma.idCardVerification.create({ data: { userId: f.user.id, idDetected: true, isThaiIdCard: true,
    imagePath: verification.imagePath, fullNameTh: verification.fullNameTh, citizenIdHash: 'different-card' } });
  let candidate = wrongIdentity;
  t.mock.method(OcrService, 'verifyIdCard', async () => ({ verificationId: candidate.id, imagePath: candidate.imagePath!,
    confidence: { idDetected: true, idPresent: true, idChecksumValid: true }, isThaiIdCard: true, fullNameTh: candidate.fullNameTh!, citizenId: '1234567890123', address: 'ที่อยู่ทดสอบ' }));
  const recheck = async () => {
    const form = new FormData(); form.set('idCard', new Blob(['synthetic card'], { type: 'image/png' }), 'card.png');
    return fetch(base + '/api/tenants/draft/upload-identity', { method: 'POST', headers: { Cookie: f.auth }, body: form });
  };
  assert.equal((await recheck()).status, 409);
  assert.equal(await prisma.payment.count({ where: { housingDraftId: firstDraft.id, housingVerificationId: verification.id, status: 'PAID' } }), 2);
  candidate = newIdentity; assert.equal((await recheck()).status, 200);
  assert.equal(await prisma.payment.count({ where: { housingDraftId: firstDraft.id, housingVerificationId: newIdentity.id, status: 'PAID' } }), 2);
  assert.equal(((await request('GET', '/api/tenants/draft', f.auth)).body.data as { paidAmount: number }).paidAmount, 200);
  verification = newIdentity;
  const contract = { ...Object.fromEntries(Object.keys(requiredContractFields).map(key => [key, 'รายละเอียด'])),
    roomNumber: air.room.roomNumber, monthlyRent: '200', depositAmount: '200', ...await getContractTerms(await prisma.room.findUniqueOrThrow({ where: { id: air.room.id } })) };
  const input = { contractAccepted: true, personalInformation: { fullName: 'ผู้สมัคร ทดสอบ', studentId: '123456', course: 'ทดสอบ', yearLevel: '1st Year',
    citizenId: '1234567890123', birthDate: '2000-01-15', address: '123 ที่อยู่ทดสอบ' },
    emergencyContact: { emergencyName: 'ผู้ปกครอง', relationship: 'Parent', emergencyNumber: '0812345678' },
    roomPreference: { preferredRoomType: 'Floor 1', roomNumber: air.room.roomNumber }, contractData: contract,
    ocrData: { verificationId: verification.id }, idCardImagePath: verification.imagePath,
    paymentId: payment.paymentVerification.id, paymentSlipPath: payment.paymentSlipPath };
  // Missing account contact is reported before application creation; paid credit survives.
  await prisma.user.update({ where: { id: f.user.id }, data: { phone: null } });
  const withoutPhone = (await request('GET', '/api/tenants/draft', f.auth)).body.data as { registeredPhone: string; paidAmount: number };
  assert.equal(withoutPhone.registeredPhone, ''); assert.equal(withoutPhone.paidAmount, 200);
  const blockedPhone = await request('POST', '/api/tenants/apply', f.auth, input);
  assert.equal(blockedPhone.status, 400); assert.ok(blockedPhone.body.message.includes('บัญชียังไม่มีเบอร์โทรศัพท์'));
  assert.equal(await prisma.tenant.count({ where: { userId: f.user.id } }), 0);
  assert.equal(await prisma.payment.count({ where: { housingDraftId: firstDraft.id, status: 'PAID', housingTenantId: null } }), 2);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).phone, null);
  await prisma.user.update({ where: { id: f.user.id }, data: { phone: '0812345678' } });
  assert.equal(((await request('GET', '/api/tenants/draft', f.auth)).body.data as { registeredPhone: string }).registeredPhone, '0812345678');
  const tampered = { ...input, contractData: { ...input.contractData, electricityRate: '999' } };
  assert.equal((await request('POST', '/api/tenants/apply', f.auth, tampered)).status, 409);
  assert.equal(await prisma.tenant.count({ where: { userId: f.user.id } }), 0);
  const submitted = await request('POST', '/api/tenants/apply', f.auth, input); assert.equal(submitted.status, 201);
  const tenant = submitted.body.data as { id: number; roomId: number }; tenants.push(tenant.id);
  assert.equal(tenant.roomId, air.room.id);
  assert.equal(await prisma.payment.count({ where: { housingTenantId: tenant.id, status: 'PAID' } }), 2);
  const repeated = await request('POST', '/api/tenants/apply', f.auth, input);
  assert.ok([200, 201].includes(repeated.status)); assert.equal((repeated.body.data as { id: number }).id, tenant.id);
  assert.equal((await prisma.housingApplicationDraft.findUniqueOrThrow({ where: { id: firstDraft.id } })).status, 'SUBMITTED');
  assert.equal((await request('PATCH', '/api/tenants/draft', f.auth, { version: saved.version, data: {}, roomNumber: f.room.roomNumber })).status, 409);
  assert.equal((await request('PATCH', `/api/tenants/${tenant.id}`, adminCookie, { status: 'ACTIVE' })).status, 200);
  assert.equal(await prisma.payment.count({ where: { housingTenantId: tenant.id, housingApprovedAt: { not: null } } }), 2);
  const approvedTenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
  for (const [type, storedPath] of [['id-card', approvedTenant.idCardImagePath], ['payment-slip', approvedTenant.paymentSlipPath]] as const) {
    assert.ok(storedPath);
    const absolute = path.join(root, storedPath.replace(/^uploads\/private\//u, ''));
    const expected = await fs.readFile(absolute);
    for (const endpoint of [`/api/tenants/me/documents/${type}`, `/api/tenants/${tenant.id}/documents/${type}`]) {
      const response = await fetch(base + endpoint, { headers: { Cookie: endpoint.includes('/me/') ? f.auth : adminCookie } });
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
    }
    assert.equal((await request('GET', `/api/tenants/${tenant.id}/documents/${type}`, air.auth)).status, 403);
    assert.equal((await request('GET', `/api/tenants/me/documents/${type}`)).status, 401);
  }
  const ownedFiles = [approvedTenant.idCardImagePath!, ...(await prisma.payment.findMany({ where: { payerUserId: f.user.id }, select: { slipPath: true } })).map(row => row.slipPath!).filter(Boolean)];
  assert.equal((await request('PATCH', `/api/tenants/${tenant.id}`, adminCookie, { status: 'INACTIVE' })).status, 200);
  // After move-out every owned transfer and draft must disappear, keeping User.
  assert.ok([200, 202].includes((await request('DELETE', `/api/tenants/${tenant.id}`, adminCookie)).status));
  assert.equal(await prisma.payment.count({ where: { payerUserId: f.user.id } }), 0);
  assert.equal(await prisma.housingApplicationDraft.count({ where: { userId: f.user.id } }), 0);
  assert.ok(await prisma.user.findUnique({ where: { id: f.user.id } }));
  // The DELETE commits database removal and queues files; exercise the worker's final step too.
  await AccountRetentionService.flushFiles();
  for (const storedPath of ownedFiles) await assert.rejects(fs.access(path.join(root, storedPath.replace(/^uploads\/private\//u, ''))), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
  assert.equal((await request('GET', '/api/tenants/me/documents/id-card', f.auth)).status, 404);

  const freshDraft = (await request('GET', '/api/tenants/draft', f.auth)).body.data as { id: number; version: number; paidAmount: number };
  assert.notEqual(freshDraft.id, firstDraft.id); assert.equal(freshDraft.paidAmount, 0);
  assert.equal((await request('PATCH', '/api/tenants/draft', f.auth, { version: freshDraft.version, roomNumber: air.room.roomNumber, data: { activeStep: 2 } })).status, 200);
  await fs.writeFile(path.join(root, 'id-cards/fixture.png'), 'fresh synthetic identity');
  verification = await prisma.idCardVerification.create({ data: { userId: f.user.id, idDetected: true, isThaiIdCard: true,
    imagePath: 'uploads/private/id-cards/fixture.png', fullNameTh: 'ผู้สมัคร ทดสอบ', citizenIdHash: hash, idChecksumValid: true } });
  candidate = verification; assert.equal((await recheck()).status, 200);
  t.mock.method(PaymentProviderClient, 'verifySlip', async () => ({ success: true, recipientMatched: true, duplicate: false, retryable: false, amount: 200, transactionId: randomUUID(), rawData: {} }));
  const newPaymentResponse = await upload(); assert.equal(newPaymentResponse.status, 200);
  const newPayment = newPaymentResponse.body.data as { paymentVerification: { id: number }; paymentSlipPath: string };
  const newInput = { ...input, ocrData: { verificationId: verification.id }, idCardImagePath: verification.imagePath,
    paymentId: newPayment.paymentVerification.id, paymentSlipPath: newPayment.paymentSlipPath };
  const reapplied = await request('POST', '/api/tenants/apply', f.auth, newInput); assert.equal(reapplied.status, 201);
  const nextTenant = reapplied.body.data as { id: number }; tenants.push(nextTenant.id);
  assert.notEqual(nextTenant.id, tenant.id);
  assert.equal(await prisma.tenant.count({ where: { userId: f.user.id } }), 1);
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
    if (String(input).includes('/owners/')) return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return originalFetch(input, options);
  });
  await FaceCleanupService.process(`face-cleanup:user:${f.user.id}`);
  assert.equal((await request('PATCH', `/api/tenants/${nextTenant.id}`, adminCookie, { status: 'APPROVED' })).status, 200);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).faceRevokedAt, null);
  assert.equal(((await request('GET', '/api/tenants/me', f.auth)).body.data as { faceEnrollmentComplete: boolean }).faceEnrollmentComplete, false);
});


test('only Admin edits account phone; normalized phone persists and draft reflects it without exposing passwords or changing role', async () => {
  const f = await fixture();
  const phone = '09' + String(f.user.id).padStart(8, '0');
  const route = `/api/users/${f.user.id}`;
  assert.equal((await request('PATCH', route, f.auth, { phone: phone })).status, 403);
  assert.equal((await request('PATCH', route, undefined, { phone: phone })).status, 401);
  for (const invalidPhone of ['invalid', '123', '1812345678', 812345678, { value: phone }]) {
    assert.equal((await request('PATCH', route, adminCookie, { phone: invalidPhone })).status, 400);
  }
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).phone, null);
  const saved = await request('PATCH', route, adminCookie, { phone: phone.slice(0, 3) + '-' + phone.slice(3, 6) + '-' + phone.slice(6) });
  assert.equal(saved.status, 200);
  const profile = saved.body.data as { phone: string; role: string; password?: string };
  assert.equal(profile.phone, phone); assert.equal(profile.role, 'STUDENT'); assert.equal(profile.password, undefined);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).phone, phone);
  const listed = (await request('GET', '/api/users', adminCookie)).body.data as Array<{ id: number; phone: string; role: string; password?: string }>;
  const own = listed.find(u => u.id === f.user.id)!;
  assert.equal(own.phone, phone); assert.equal(own.role, 'STUDENT'); assert.equal(own.password, undefined);
  const other = await fixture();
  assert.equal((await request('PATCH', `/api/users/${other.user.id}`, adminCookie, { phone })).status, 409);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: other.user.id } })).phone, null);
  assert.equal(((await request('GET', '/api/tenants/draft', f.auth)).body.data as { registeredPhone: string }).registeredPhone, phone);
});


test('resident notification history is scoped and delivery administration is Admin-only', async () => {
  const f = await fixture(); const other = await fixture();
  assert.equal((await create(f.auth)).status, 201);
  const notification = await prisma.notification.findFirstOrThrow({ where: { tenantId: f.tenant.id } });
  const own = (await request('GET', '/api/notifications', f.auth)).body.data as Array<{ id: number }>;
  const hidden = (await request('GET', '/api/notifications', other.auth)).body.data as Array<{ id: number }>;
  assert.ok(own.some(row => row.id === notification.id)); assert.ok(!hidden.some(row => row.id === notification.id));
  for (const [method, route] of [['GET', '/audit-logs'], ['GET', '/dead-letters'], ['POST', '/'], ['POST', `/${notification.id}/send`], ['POST', '/dead-letters/1/retry'], ['DELETE', '/dead-letters/1']]) {
    assert.equal((await request(method!, '/api/notifications' + route, f.auth, method === 'POST' ? {} : undefined)).status, 403);
    assert.equal((await request(method!, '/api/notifications' + route, undefined, method === 'POST' ? {} : undefined)).status, 401);
  }
  assert.equal((await request('GET', '/api/notifications/audit-logs', adminCookie)).status, 200);
});


test('concurrent monthly room billing creates one set, accepts Thai month aliases and conserves every satang', async () => {
  const f = await fixture(); const second = await fixture(); const third = await fixture(); const pending = await fixture();
  const roomNumber = f.room.roomNumber.toUpperCase();
  await prisma.room.update({ where: { id: f.room.id }, data: { roomNumber } });
  await prisma.tenant.update({ where: { id: second.tenant.id }, data: { roomId: f.room.id, status: 'APPROVED' } });
  await prisma.tenant.update({ where: { id: third.tenant.id }, data: { roomId: f.room.id } });
  await prisma.tenant.update({ where: { id: pending.tenant.id }, data: { roomId: f.room.id, status: 'PENDING' } });
  const info = (await request('GET', `/api/billing/room-info/${roomNumber}`, adminCookie)).body.data as { tenantCount: number };
  assert.equal(info.tenantCount, 3);
  const input = { roomNumber, electricUnits: 0.01, waterAmount: 0.01, customRent: 100.01,
    dueDate: new Date(Date.now() + 86400000).toISOString(), billingMonth: '2026-11' };
  const responses = await Promise.all(['2026-11', 'พฤศจิกายน 2569', 'พฤศจิกายน 2026', 'พฤศจิกายน ๒๕๖๙'].map(billingMonth =>
    request('POST', '/api/billing/generate-room-bill', adminCookie, { ...input, billingMonth })));
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409, 409, 409]);
  const bills = await prisma.bill.findMany({ where: { roomId: f.room.id }, orderBy: { tenantId: 'asc' } });
  assert.equal(bills.length, 3); assert.ok(bills.every(bill => bill.billingPeriod === '2026-11'));
  assert.ok(!bills.some(bill => bill.tenantId === pending.tenant.id));
  const cents = (value: unknown) => Math.round(Number(value) * 100);
  assert.equal(bills.reduce((sum, bill) => sum + cents(bill.rentAmount), 0), 10001);
  assert.equal(bills.reduce((sum, bill) => sum + cents(bill.electricAmount), 0), 8);
  assert.equal(bills.reduce((sum, bill) => sum + cents(bill.waterAmount), 0), 1);
  assert.equal(bills.reduce((sum, bill) => sum + cents(bill.amount), 0), 10010);
  for (const bill of bills) assert.equal(cents(bill.amount), cents(bill.rentAmount) + cents(bill.electricAmount) + cents(bill.waterAmount));
  const amounts = bills.map(bill => cents(bill.amount));
  assert.ok(Math.max(...amounts) - Math.min(...amounts) <= 1);
  assert.equal((await request('POST', '/api/billing/generate-room-bill', adminCookie, { ...input, customRent: 999 })).status, 409);
  assert.equal(await prisma.bill.count({ where: { roomId: f.room.id } }), 3);
  // The database constraint also rejects a bypass of the normal service.
  await assert.rejects(prisma.bill.create({ data: { tenantId: f.tenant.id, roomId: f.room.id, billingPeriod: '2026-11', amount: 1, dueDate: new Date() } }),
    (error: unknown) => (error as { code?: string }).code === 'P2002');
  assert.equal((await request('POST', '/api/billing/generate-room-bill', adminCookie, { ...input, billingMonth: '2026-12' })).status, 201);
  assert.equal(await prisma.bill.count({ where: { roomId: f.room.id } }), 6);
});

test('billing rejects invalid numbers, dates and periods without writing and excludes unapproved residents', async () => {
  const f = await fixture(); const roomNumber = f.room.roomNumber.toUpperCase();
  await prisma.room.update({ where: { id: f.room.id }, data: { roomNumber } });
  const input = { roomNumber, electricUnits: 1, billingMonth: '2026-11', dueDate: new Date().toISOString() };
  for (const invalid of [{ electricUnits: null }, { electricUnits: {} }, { electricUnits: true }, { electricUnits: '' },
    { electricUnits: -1 }, { electricUnits: 'Infinity' }, { electricRate: -1 }, { waterAmount: -1 }, { customRent: 100000000 },
    { dueDate: 'invalid' }, { billingMonth: '2026-13' }, { billingMonth: '2026-00' }, { billingMonth: 'arbitrary label' }]) {
    assert.equal((await request('POST', '/api/billing/generate-room-bill', adminCookie, { ...input, ...invalid })).status, 400);
  }
  assert.equal(await prisma.bill.count({ where: { roomId: f.room.id } }), 0);
  await prisma.tenant.update({ where: { id: f.tenant.id }, data: { status: 'PENDING' } });
  assert.equal((await request('POST', '/api/billing/generate-room-bill', adminCookie, input)).status, 400);
  assert.equal(await prisma.bill.count({ where: { roomId: f.room.id } }), 0);
});

test('legacy room bills with an unknown period require review and are not erased or billed again', async () => {
  const f = await fixture(); const roomNumber = f.room.roomNumber.toUpperCase();
  await prisma.room.update({ where: { id: f.room.id }, data: { roomNumber } });
  const old = await prisma.bill.create({ data: { tenantId: f.tenant.id, roomId: f.room.id, amount: 100, dueDate: new Date(), status: 'PAID' } });
  assert.equal((await request('POST', '/api/billing/generate-room-bill', adminCookie, { roomNumber, electricUnits: 1, billingMonth: '2026-11' })).status, 409);
  assert.equal(await prisma.bill.count({ where: { roomId: f.room.id } }), 1);
  const retained = await prisma.bill.findUniqueOrThrow({ where: { id: old.id } });
  assert.equal(retained.status, 'PAID'); assert.equal(Number(retained.amount), 100); assert.equal(retained.billingPeriod, null);
});


test('room billing racing with move-out cannot create debt for a resident who has already left', async () => {
  const f = await fixture(); const roomNumber = f.room.roomNumber.toUpperCase();
  await prisma.room.update({ where: { id: f.room.id }, data: { roomNumber } });
  const [generated, moved] = await Promise.all([
    request('POST', '/api/billing/generate-room-bill', adminCookie, { roomNumber, electricUnits: 0, billingMonth: '2026-11' }),
    request('PATCH', `/api/tenants/${f.tenant.id}`, adminCookie, { status: 'INACTIVE' }),
  ]);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: f.tenant.id } });
  const count = await prisma.bill.count({ where: { tenantId: f.tenant.id } });
  if (generated.status === 201) {
    assert.equal(moved.status, 409); assert.equal(count, 1); assert.equal(tenant.isActive, true); assert.equal(tenant.roomId, f.room.id);
  } else {
    assert.ok([400, 409].includes(generated.status)); assert.equal(moved.status, 200);
    assert.equal(count, 0); assert.equal(tenant.status, 'INACTIVE'); assert.equal(tenant.roomId, null);
  }
});


test('registration to cookie login, heartbeat and browser logout persists identity without returning credentials', async () => {
  const tag = randomUUID();
  const input = { email: `${tag}@example.test`, username: `qa_${tag}`, phone: `080${Math.floor(Math.random() * 10000000).toString().padStart(7, '0')}`, password: 'QaTest!2026Strong', role: 'ADMIN' };
  const registered = await request('POST', '/api/auth/register', undefined, input);
  assert.equal(registered.status, 201);
  const identity = registered.body.data as { id: number; role: string };
  users.push(identity.id);
  assert.equal(identity.role, 'STUDENT');
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: identity.id } });
  assert.notEqual(stored.password, input.password); assert.equal(stored.phone, input.phone);
  assert.equal((await request('POST', '/api/auth/register', undefined, input)).status, 400);
  assert.equal(await prisma.user.count({ where: { email: input.email } }), 1);
  assert.equal((await request('POST', '/api/auth/login', undefined, { email: input.email, password: 'wrong' })).status, 401);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: identity.id } })).lastLogin, null);
  const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: input.email, password: input.password }) });
  assert.equal(response.status, 200);
  const body = await response.json() as Envelope;
  assert.equal(body.success, true); assert.equal(body.statusCode, 200);
  assert.ok(!Object.hasOwn(body.data as object, 'token'));
  assert.ok(!JSON.stringify(body).includes(input.password));
  const setCookie = response.headers.get('set-cookie')!;
  assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /SameSite=Lax/i);
  const session = setCookie.split(';')[0];
  assert.equal((await request('GET', '/api/auth/me', session)).status, 200);
  await prisma.user.update({ where: { id: identity.id }, data: { version: { increment: 1 } } });
  assert.equal((await request('GET', '/api/auth/me', session)).status, 200, 'Data OCC must not invalidate a session');
  const lastLogin = (await prisma.user.findUniqueOrThrow({ where: { id: identity.id } })).lastLogin!.getTime();
  assert.equal((await request('POST', '/api/auth/heartbeat', session)).status, 200);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: identity.id } })).lastLogin!.getTime(), lastLogin);
  const logout = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Cookie: session } });
  assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie')!, /access_token=;/);
  assert.equal((await request('GET', '/api/auth/me')).status, 401);
  const replay = await request('GET', '/api/auth/me', session);
  assert.equal(replay.status, 401, 'Copied cookies must be revoked server-side');
});

test('Admin overview, settings, audit and billing reports reach HTTP/database endpoints while Student roles are denied', async () => {
  const f = await fixture();
  for (const route of ['/api/analytics/dashboard', '/api/audit-logs', '/api/settings', '/api/users', '/api/billing/report']) {
    assert.equal((await request('GET', route)).status, 401, route);
    assert.equal((await request('GET', route, f.auth)).status, 403, route);
    assert.equal((await request('GET', route, adminCookie)).status, 200, route);
  }
  for (const route of ['/api/rooms', `/api/rooms/${f.room.id}`, '/api/notifications/preferences']) {
    assert.equal((await request('GET', route)).status, 401, route);
    assert.equal((await request('GET', route, f.auth)).status, 200, route);
  }
  assert.equal((await request('GET', '/api/rooms/999999999', adminCookie)).status, 404);
  assert.equal((await request('PATCH', '/api/settings', f.auth, { maxOccupants: '2' })).status, 403);
  assert.equal((await request('PATCH', '/api/settings', adminCookie, { maxOccupants: '0' })).status, 400);
});

test('staged repair photos are owner-bound, consumed on successful submission and removed after expiry', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repair-upload-qa-'));
  const originalRoot = process.env.UPLOAD_ROOT; process.env.UPLOAD_ROOT = root;
  t.after(async () => { if (originalRoot === undefined) delete process.env.UPLOAD_ROOT; else process.env.UPLOAD_ROOT = originalRoot; await fs.rm(root, { recursive: true, force: true }); });
  const f = await fixture(); const other = await fixture();
  const upload = async () => {
    const form = new FormData(); form.set('image', new Blob(['QA image'], { type: 'image/png' }), 'unsafe.html');
    const res = await fetch(base + '/api/maintenance/upload', { method: 'POST', headers: { Cookie: f.auth }, body: form });
    assert.equal(res.status, 200); return (await res.json()).data.filename as string;
  };
  const filename = await upload(); assert.match(filename, /\.png$/);
  const payload = { category: 'OTHER', description: `[IMAGE:${filename}] | QA repair issue` };
  assert.equal((await request('POST', '/api/maintenance', other.auth, payload)).status, 400);
  assert.ok(await prisma.systemSetting.findUnique({ where: { key: `maintenance-upload:${filename}` } }));
  assert.equal((await request('POST', '/api/maintenance', f.auth, payload)).status, 201);
  assert.equal(await prisma.systemSetting.findUnique({ where: { key: `maintenance-upload:${filename}` } }), null);
  const abandoned = await upload();
  await prisma.systemSetting.update({ where: { key: `maintenance-upload:${abandoned}` }, data: { value: JSON.stringify({ expiresAt: new Date(0).toISOString() }) } });
  await MaintenanceService.cleanupExpiredUploads();
  await assert.rejects(fs.access(path.join(root, abandoned)));
  await fs.access(path.join(root, filename));
  assert.equal(await prisma.systemSetting.findUnique({ where: { key: `maintenance-upload:${abandoned}` } }), null);
});

test('unsupported 2FA and malformed contract settings do not claim security or alter existing values', async () => {
  for (const input of [{ twoFactorAuthentication: 'true' }, { contractElectricityRate: '-1' }, { contractStartDate: '2026-02-30' }, { contractEndDate: '2020-01-01' }]) {
    assert.equal((await request('PATCH', '/api/settings', adminCookie, input)).status, 400);
  }
  const settings = (await request('GET', '/api/settings', adminCookie)).body.data as { settings: Record<string, string> };
  assert.equal(settings.settings.twoFactorAuthentication, 'false');
});

test('missing contract configuration stops new QR generation before provider work', async t => {
  const f = await fixture();
  const { HousingPaymentService } = await import('../../src/modules/tenants/housing-payment.service');
  const provider = t.mock.method(PaymentProviderClient, 'generateQr', async () => Buffer.from('Must not call'));
  const setting = await prisma.systemSetting.findUniqueOrThrow({ where: { key: 'contractLandlordName' } });
  await prisma.systemSetting.update({ where: { id: setting.id }, data: { value: '' } });
  try {
    await assert.rejects(HousingPaymentService.generateQr(f.room.roomNumber), { statusCode: 409 });
    assert.equal(provider.mock.callCount(), 0);
  } finally { await prisma.systemSetting.update({ where: { id: setting.id }, data: { value: setting.value } }); }
});

test('phone edits keep sessions while a real role change revokes the previous token', async () => {
  const f = await fixture();
  assert.equal((await request('PATCH', `/api/users/${f.user.id}`, adminCookie, { role: 'STUDENT', phone: '09' + String(f.user.id).padStart(8, '0') })).status, 200);
  assert.equal((await request('GET', '/api/auth/me', f.auth)).status, 200);
  assert.equal((await request('PATCH', `/api/users/${f.user.id}`, adminCookie, { role: 'STAFF' })).status, 400);
  assert.equal((await request('GET', '/api/auth/me', f.auth)).status, 200);
  assert.equal((await request('PATCH', `/api/users/${f.user.id}`, adminCookie, { role: 'ADMIN' })).status, 200);
  assert.equal((await request('GET', '/api/auth/me', f.auth)).status, 401);
});


test('resident enrollment completion persists, owner checks hold, purge clears it, and new approval waits for cleanup', async (t) => {
  const originalFetch = globalThis.fetch;
  const f = await fixture();
  const completion = '/api/tenants/me/face-enrollment/complete';
  assert.equal((await request('POST', completion)).status, 401);
  assert.equal((await request('POST', completion, adminCookie)).status, 403);
  assert.equal((await request('POST', completion, f.auth)).status, 409);
  const photoPaths = Array.from({ length: 5 }, (_, i) => `uploads/face-photo/test-resident-${f.user.id}-${i}.jpg`);
  await fs.mkdir('uploads/face-photo', { recursive: true });
  for (const photoPath of photoPaths) await fs.writeFile(photoPath, 'synthetic enrollment fixture');
  t.after(async () => { for (const photoPath of photoPaths) await fs.rm(photoPath, { force: true }); });
  await prisma.faceEnrollmentPhoto.createMany({ data: photoPaths.map(photoPath => ({ userId: f.user.id, photoPath })) });
  const other = await fixture();
  assert.equal((await request('POST', completion, other.auth, { userId: f.user.id })).status, 409);
  assert.equal((await request('POST', completion, f.auth)).status, 200);
  assert.equal((await request('POST', completion, f.auth)).status, 200);
  assert.equal(await prisma.accessLog.count({ where: { userId: f.user.id, method: 'FACE_ENROLLMENT_COMPLETE' } }), 1);
  const profile = (await request('GET', '/api/tenants/me', f.auth)).body.data as { faceEnrollmentComplete: boolean; user: object };
  assert.equal(profile.faceEnrollmentComplete, true);
  assert.equal('_count' in profile.user, false); assert.equal('accessLogs' in profile.user, false);
  assert.equal((await request('PATCH', `/api/tenants/${f.tenant.id}`, adminCookie, { status: 'INACTIVE' })).status, 200);
  assert.ok([200, 202].includes((await request('DELETE', `/api/tenants/${f.tenant.id}`, adminCookie)).status));
  assert.equal(await prisma.faceEnrollmentPhoto.count({ where: { userId: f.user.id } }), 0);
  assert.equal(await prisma.faceEmbedding.count({ where: { userId: f.user.id } }), 0);
  assert.equal(await prisma.accessLog.count({ where: { userId: f.user.id, method: 'FACE_ENROLLMENT_COMPLETE' } }), 0);
  assert.equal((await request('GET', '/api/tenants/me', f.auth)).body.data, null);
  assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).faceRevokedAt);
  const next = await prisma.tenant.create({ data: { userId: f.user.id, roomId: f.room.id, status: 'PENDING', isActive: true } }); tenants.push(next.id);
  assert.equal((await request('PATCH', `/api/tenants/${next.id}`, adminCookie, { status: 'APPROVED' })).status, 409);
  assert.equal((await prisma.tenant.findUniqueOrThrow({ where: { id: next.id } })).status, 'PENDING');
  // External owner deletion is mocked; actual files/DB cleanup use the worker service.
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
    if (String(input).includes('/owners/')) return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return originalFetch(input, options);
  });
  await FaceCleanupService.process(`face-cleanup:user:${f.user.id}`);
  assert.equal((await FaceCleanupService.status(`face-cleanup:user:${f.user.id}`)).status, 'COMPLETE');
  for (const photoPath of photoPaths) await assert.rejects(fs.access(photoPath), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
  assert.equal((await request('PATCH', `/api/tenants/${next.id}`, adminCookie, { status: 'APPROVED' })).status, 200);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).faceRevokedAt, null);
  assert.equal(((await request('GET', '/api/tenants/me', f.auth)).body.data as { faceEnrollmentComplete: boolean }).faceEnrollmentComplete, false);
});
