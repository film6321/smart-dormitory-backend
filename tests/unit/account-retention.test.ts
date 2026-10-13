import bcrypt from 'bcrypt';
import { AuthService } from '../../src/modules/auth/auth.service';
import { AuthRepository } from '../../src/modules/auth/auth.repository';
import * as presence from '../../src/shared/presence';
import fs from 'node:fs/promises';
import os from 'node:os';
import assert from 'node:assert/strict';
import path from 'node:path';
import { it, TestContext } from 'node:test';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../../src/database/db';
import { AccountRetentionService, inactiveForYear, inactivityCutoff } from '../../src/modules/users/account-retention.service';
import { TenantsService } from '../../src/modules/tenants/tenants.service';
import { validateTenantUpdate } from '../../src/modules/tenants/tenants.dto';
import * as settings from '../../src/modules/settings/settings.service';

const now = new Date('2026-10-07T05:00:00Z');
const old = new Date('2025-10-07T05:00:00Z');
const baseUser = { id: 11, version: 1, role: Role.STUDENT, lastLogin: old, createdAt: new Date('2024-01-01'), tenant: null as Record<string, unknown> | null };
const baseTenant = { id: 55, userId: 11, roomId: null as number | null, status: 'INACTIVE', isActive: false, fullName: 'Private name', idCardImagePath: null, paymentSlipPath: null, checkInDate: old, checkOutDate: now };
type Args = { where?: Record<string, unknown>; data?: Record<string, unknown> };
function fixture(t: TestContext, user: Omit<typeof baseUser, 'role'> & { role: Role } = { ...baseUser }) {
  const writes: Array<{ model: string; method: string; args: Args }> = [];
  const locks: string[] = [];
  let tenant = { ...baseTenant };
  const tx: Record<string, unknown> = {};
  for (const model of ['user', 'tenant', 'bill', 'maintenanceTicket', 'payment', 'paymentBatch', 'paymentBatchItem', 'ocrJob', 'visitor', 'visitorLog', 'notification', 'notificationPreference', 'faceEnrollmentPhoto', 'faceEmbedding', 'idCardVerification', 'accessLog', 'systemSetting', 'transaction', 'room', 'housingApplicationDraft']) {
    tx[model] = {
      count: async () => 0,
      findMany: async () => [],
      findUnique: async () => model === 'user' ? user : model === 'tenant' ? tenant : null,
      update: async (args: Args) => { writes.push({ model, method: 'update', args }); if (model === 'tenant') tenant = { ...tenant, ...args.data }; return model === 'tenant' ? tenant : user; },
      updateMany: async (args: Args) => { writes.push({ model, method: 'updateMany', args }); return { count: 1 }; },
      deleteMany: async (args: Args) => { writes.push({ model, method: 'deleteMany', args }); return { count: 1 }; },
      delete: async (args: Args) => { writes.push({ model, method: 'delete', args }); return user; },
      upsert: async (args: Args) => { writes.push({ model, method: 'upsert', args }); return {}; },
    };
  }
  tx.$queryRaw = async (parts: TemplateStringsArray) => { locks.push(parts.join('?')); return []; };
  const client = tx as unknown as Prisma.TransactionClient;
  (tx.user as { findMany: () => Promise<unknown> }).findMany = async () => [{ id: user.id }];
  const db = { ...tx, $transaction: (run: (db: Prisma.TransactionClient) => Promise<unknown>) => run(client) } as unknown as typeof prisma;
  const flush = t.mock.method(AccountRetentionService, 'flushFiles', async () => {});
  return { tx: client, db, writes, locks, user, flush, setTenant: (value: typeof tenant) => { tenant = value; } };
}

it('retention uses the last successful login, one calendar year, and createdAt only when never logged in', () => {
  assert.equal(inactiveForYear(baseUser, now), true);
  assert.equal(inactiveForYear({ ...baseUser, lastLogin: new Date(old.getTime() + 1) }, now), false);
  assert.equal(inactiveForYear({ ...baseUser, lastLogin: now }, now), false);
  assert.equal(inactiveForYear({ ...baseUser, lastLogin: null, createdAt: old }, now), true);
  assert.equal(inactiveForYear({ ...baseUser, lastLogin: null, createdAt: now }, now), false);
  assert.equal(inactiveForYear({ ...baseUser, role: 'ADMIN' }, now), false);
  assert.equal(inactivityCutoff(new Date('2024-02-29T13:00:00Z')).toISOString(), '2023-02-28T13:00:00.000Z');
});
it('dry-run locks and rechecks the account without writing or unlinking files', async t => {
  const f = fixture(t);
  assert.deepEqual(await AccountRetentionService.process(now, true, f.db), { candidates: 1, eligible: 1, deleted: 0, skipped: 0 });
  assert.equal(f.writes.length, 0); assert.equal(f.flush.mock.callCount(), 0);
  assert.ok(f.locks[0].includes('"User"'));
});
it('a successful login after candidate selection prevents deletion under the account lock', async t => {
  const f = fixture(t, { ...baseUser, lastLogin: now });
  assert.equal((await AccountRetentionService.process(now, false, f.db)).deleted, 0);
  assert.equal(f.writes.length, 0);
});
it('accounts still occupying a room are never automatically purged', async t => {
  const f = fixture(t, { ...baseUser, tenant: { ...baseTenant, status: 'ACTIVE', roomId: 22 } });
  assert.equal((await AccountRetentionService.process(now, false, f.db)).skipped, 1);
  assert.equal(f.writes.length, 0);
});
it('unsettled bills block automatic and manual removal before any writes', async t => {
  const f = fixture(t, { ...baseUser, tenant: { ...baseTenant } });
  t.mock.method(f.tx.bill, 'count', async () => 1);
  assert.equal((await AccountRetentionService.process(now, false, f.db)).deleted, 0);
  await assert.rejects(AccountRetentionService.deleteTenant(55, f.tx), /ค้าง/u);
  assert.equal(f.writes.length, 0);
});
it('shared batches belonging to another resident block manual removal', async t => {
  const f = fixture(t);
  t.mock.method(f.tx.paymentBatch, 'count', async () => 1);
  await assert.rejects(AccountRetentionService.deleteTenant(55, f.tx), /บิลรวม/u);
  assert.equal(f.writes.length, 0);
});
it('pending OCR and payment work blocks automatic account removal', async t => {
  const f = fixture(t);
  t.mock.method(f.tx.ocrJob, 'count', async () => 1);
  assert.equal((await AccountRetentionService.process(now, false, f.db)).deleted, 0);
  assert.equal(f.writes.length, 0);
});
it('manual removal deletes the profile and its financial rows while retaining the user', async t => {
  const f = fixture(t);
  await AccountRetentionService.deleteTenant(55, f.tx);
  assert.ok(f.writes.some(w => w.model === 'tenant' && w.method === 'delete'));
  assert.equal(f.writes.some(w => w.model === 'user' && w.method === 'delete'), false);
  for (const model of ['bill', 'payment', 'paymentBatch', 'transaction']) assert.ok(f.writes.some(w => w.model === model && w.method === 'deleteMany'));
  assert.ok(f.writes.some(w => w.model === 'faceEmbedding' && w.method === 'deleteMany'));
});
it('automatic removal clears owned artifacts and deletes only an eligible user', async t => {
  const f = fixture(t, { ...baseUser, tenant: { ...baseTenant } });
  assert.equal((await AccountRetentionService.process(now, false, f.db)).deleted, 1);
  assert.equal(f.writes.filter(w => w.model === 'user' && w.method === 'delete').length, 1);
  assert.deepEqual(f.writes.find(w => w.model === 'transaction')!.args.where, { userId: baseUser.id });
  assert.equal(f.flush.mock.callCount(), 0);
});
it('upload cleanup accepts stored private paths and rejects traversal or unrelated paths', () => {
  const target = AccountRetentionService.resolveFile('id-cards/example.jpg');
  assert.ok(target.endsWith(path.join('id-cards', 'example.jpg')));
  assert.equal(AccountRetentionService.resolveFile('uploads/private/id-cards/example.jpg'), target);
  assert.throws(() => AccountRetentionService.resolveFile('../../package.json'));
  assert.throws(() => AccountRetentionService.resolveFile(path.resolve('package.json')));
});
it('move-out sets status, checkout date, inactive flag and disconnects the room', async t => {
  const f = fixture(t); f.setTenant({ ...baseTenant, status: 'ACTIVE', roomId: 22, checkOutDate: null as unknown as Date });
  t.mock.method(settings, 'getSettingValue', async () => '4');
  await TenantsService.updateTenant(55, { status: 'INACTIVE' }, f.tx);
  const data = f.writes.find(w => w.model === 'tenant')!.args.data!;
  assert.equal(data.status, 'INACTIVE'); assert.equal(data.isActive, false);
  assert.ok(data.checkOutDate instanceof Date); assert.deepEqual(data.room, { disconnect: true });
});
it('moved-out records cannot be reactivated or reassigned', async t => {
  const f = fixture(t);
  await assert.rejects(TenantsService.updateTenant(55, { status: 'APPROVED' }, f.tx), /ใบสมัครใหม่/u);
  await assert.rejects(TenantsService.updateTenant(55, { roomId: 22 }, f.tx), /ใบสมัครใหม่/u);
  assert.equal(f.writes.filter(w => w.model === 'tenant').length, 0);
});
it('move-out refuses unpaid bills and inconsistent deactivation', async t => {
  const f = fixture(t); f.setTenant({ ...baseTenant, status: 'ACTIVE', roomId: 22 });
  t.mock.method(f.tx.bill, 'count', async () => 1);
  await assert.rejects(TenantsService.updateTenant(55, { status: 'INACTIVE' }, f.tx), /บิลค้าง/u);
  await assert.rejects(TenantsService.updateTenant(55, { isActive: false }, f.tx), /ย้ายออก/u);
});
it('tenant status DTO rejects malformed dates, booleans, IDs and unknown fields', () => {
  assert.equal(validateTenantUpdate({ status: 'INACTIVE' }).status, 'INACTIVE');
  for (const input of [{ isActive: 'false' }, { checkOutDate: 'bad-date' }, { roomId: -1 }, { status: 'ARCHIVED' }, { lastLogin: '2026-10-07' }, null]) assert.throws(() => validateTenantUpdate(input));
});


it('file cleanup retains files still referenced by others, retries later, and safely accepts missing files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dorm-retention-test-'));
  const previousRoot = process.env.UPLOAD_ROOT;
  process.env.UPLOAD_ROOT = root;
  t.after(async () => { if (previousRoot === undefined) delete process.env.UPLOAD_ROOT; else process.env.UPLOAD_ROOT = previousRoot; assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  const file = path.join(root, 'test-only.txt'); await fs.writeFile(file, 'test fixture');
  let refs = 1; let removed = 0;
  const db: Record<string, unknown> = {};
  for (const model of ['tenant', 'payment', 'paymentBatch', 'idCardVerification', 'ocrJob', 'visitor', 'faceEnrollmentPhoto', 'maintenanceTicket']) db[model] = { count: async () => model === 'tenant' ? refs : 0 };
  db.systemSetting = { findMany: async () => [{ id: 1, key: 'retention-file:test', value: file }], delete: async () => { removed++; } };
  await AccountRetentionService.flushFiles(db as unknown as typeof prisma);
  assert.equal(await fs.readFile(file, 'utf8'), 'test fixture'); assert.equal(removed, 0);
  refs = 0;
  await AccountRetentionService.flushFiles(db as unknown as typeof prisma);
  await assert.rejects(fs.stat(file)); assert.equal(removed, 1);
  await AccountRetentionService.flushFiles(db as unknown as typeof prisma); assert.equal(removed, 2);
});

it('file cleanup refuses a resolved symlink target outside uploads and keeps its retry entry', async t => {
  const db: Record<string, unknown> = {};
  for (const model of ['tenant', 'payment', 'paymentBatch', 'idCardVerification', 'ocrJob', 'visitor', 'faceEnrollmentPhoto', 'maintenanceTicket']) db[model] = { count: async () => 0 };
  const target = path.resolve(process.env.UPLOAD_ROOT || 'uploads/private', 'test-only.txt');
  let removed = false;
  db.systemSetting = { findMany: async () => [{ id: 1, key: 'retention-file:test', value: target }], delete: async () => { removed = true; } };
  t.mock.method(fs, 'realpath', async () => path.resolve('package.json'));
  const unlink = t.mock.method(fs, 'unlink', async () => {});
  await AccountRetentionService.flushFiles(db as unknown as typeof prisma);
  assert.equal(unlink.mock.callCount(), 0); assert.equal(removed, false);
});


it('login is not successful when the inactivity timestamp cannot be persisted', async t => {
  const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = 'retention-unit-test-secret-only';
  t.after(() => { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
  t.mock.method(AuthRepository, 'findByEmail', async () => ({ ...baseUser, email: 'unit@example.test', username: 'unit', password: 'mock', updatedAt: old }));
  t.mock.method(bcrypt, 'compare', async () => true);
  t.mock.method(settings, 'getSettingValue', async () => '30');
  t.mock.method(AuthRepository, 'updateUser', async () => { throw { code: 'P2022' }; });
  const online = t.mock.method(presence, 'markUserOnline', async () => {});
  await assert.rejects(AuthService.login('unit@example.test', 'mock'), (error: unknown) => (error as { statusCode: number }).statusCode === 503);
  assert.equal(online.mock.callCount(), 0);
});

it('successful login persists lastLogin before marking presence or returning the token', async t => {
  const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = 'retention-unit-test-secret-only';
  t.after(() => { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
  const order: string[] = [];
  const user = { ...baseUser, email: 'unit@example.test', username: 'unit', password: 'mock', updatedAt: old };
  t.mock.method(AuthRepository, 'findByEmail', async () => user);
  t.mock.method(bcrypt, 'compare', async () => true);
  t.mock.method(settings, 'getSettingValue', async () => '30');
  const save = t.mock.method(AuthRepository, 'updateUser', async () => { order.push('persist'); return user; });
  t.mock.method(presence, 'markUserOnline', async () => { order.push('presence'); });
  const response = await AuthService.login('unit@example.test', 'mock');
  assert.deepEqual(order, ['persist', 'presence']); assert.ok(response.token);
  assert.ok((save.mock.calls[0].arguments[1] as { lastLogin: Date }).lastLogin instanceof Date);
});

it('manual account removal uses the same eligibility guards and queues faces before deleting the account', async t => {
  const f = fixture(t, { ...baseUser, tenant: { ...baseTenant } });
  const receipt = await AccountRetentionService.deleteUser(baseUser.id, f.db);
  assert.equal(receipt.status, 'PENDING');
  const queue = f.writes.findIndex(write => write.model === 'systemSetting' && write.method === 'upsert');
  const deletion = f.writes.findIndex(write => write.model === 'user' && write.method === 'delete');
  assert.ok(queue >= 0 && deletion > queue);
  assert.ok(f.writes.some(write => write.model === 'tenant' && write.method === 'delete'));
});
it('manual administrator-account removal is blocked before writes', async t => {
  const f = fixture(t, { ...baseUser, role: 'ADMIN' });
  await assert.rejects(AccountRetentionService.deleteUser(baseUser.id, f.db), /ผู้ดูแล/);
  assert.equal(f.writes.length, 0);
});


it('tenant purge queues repair attachments before removing tickets and rejects unsafe filenames', async t => {
  const f = fixture(t);
  t.mock.method(f.tx.maintenanceTicket, 'findMany', async () => [
    { description: '[IMAGE:fixture-repair.jpg] | Broken tap' },
    { description: 'No attachment' },
  ] as never);
  await AccountRetentionService.deleteTenant(55, f.tx);
  const fileWrite = f.writes.find(w => w.model === 'systemSetting' && w.method === 'upsert'
    && (w.args as unknown as { create?: { category?: string } }).create?.category === 'RETENTION_FILES');
  assert.ok(fileWrite);
  const stored = (fileWrite.args as unknown as { create: { value: string } }).create.value;
  assert.equal(stored, path.resolve(process.env.UPLOAD_ROOT || 'uploads/maintenance', 'fixture-repair.jpg'));
  assert.ok(f.writes.findIndex(w => w === fileWrite) < f.writes.findIndex(w => w.model === 'maintenanceTicket' && w.method === 'deleteMany'));
  f.setTenant({ ...baseTenant });
  t.mock.method(f.tx.maintenanceTicket, 'findMany', async () => [{ description: '[IMAGE:../../private.txt]' }] as never);
  const before = f.writes.length;
  await assert.rejects(AccountRetentionService.purgeTenant(f.tx, 55), /ก่อนลบ/u);
  assert.equal(f.writes.length, before);
});

it('repair image cleanup keeps another ticket attachment and removes the file only after all references are gone', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dorm-repair-cleanup-'));
  const previousRoot = process.env.UPLOAD_ROOT;
  process.env.UPLOAD_ROOT = root;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.UPLOAD_ROOT; else process.env.UPLOAD_ROOT = previousRoot;
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  const image = path.join(root, 'fixture-repair.jpg');
  await fs.writeFile(image, 'test fixture');
  let refs = 1, removed = 0;
  const db: Record<string, unknown> = {};
  for (const model of ['tenant', 'payment', 'paymentBatch', 'idCardVerification', 'ocrJob', 'visitor', 'faceEnrollmentPhoto']) db[model] = { count: async () => 0 };
  db.maintenanceTicket = { count: async (args: { where: { description: { startsWith: string } } }) => {
    assert.equal(args.where.description.startsWith, '[IMAGE:fixture-repair.jpg]'); return refs;
  } };
  db.systemSetting = { findMany: async () => [{ id: 1, value: image }], delete: async () => { removed++; } };
  await AccountRetentionService.flushFiles(db as unknown as typeof prisma);
  assert.equal(await fs.readFile(image, 'utf8'), 'test fixture');
  assert.equal(removed, 0);
  refs = 0;
  await AccountRetentionService.flushFiles(db as unknown as typeof prisma);
  await assert.rejects(fs.stat(image));
  assert.equal(removed, 1);
});
