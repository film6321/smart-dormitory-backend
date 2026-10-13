import { getContractTerms } from '../../src/modules/settings/settings.service';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import tenantsRoutes from '../../src/modules/tenants/tenants.routes';
import { errorHandler } from '../../src/middlewares/error-handler';
import { OcrService } from '../../src/modules/ocr/ocr.service';
import { requiredContractFields } from '../../src/modules/tenants/tenants.dto';
import { prisma } from '../../src/database/db';
import { AppError } from '../../src/middlewares/error-handler';
import { TenantsService, type SubmitApplicationInput } from '../../src/modules/tenants/tenants.service';
import { ROOM_RESERVATION_FILTER } from '../../src/modules/tenants/tenants.repository';
import { HousingPaymentService } from '../../src/modules/tenants/housing-payment.service';
import { PaymentProviderClient, type PaymentVerificationResult } from '../../src/modules/billing/payment.provider';
import { BillingService } from '../../src/modules/billing/billing.service';
import { PaymentBatchService } from '../../src/modules/billing/payment-batch.service';
import * as redis from '../../src/shared/redis';
import { assertSlipAvailable } from '../../src/modules/billing/payment-slip-guard';

// Run only against the disposable database prepared for this suite.
if (new URL(process.env.DATABASE_URL!).pathname !== '/housing_payment_test') {
  throw new Error('Housing payment integration tests require the isolated housing_payment_test database');
}
let userId: number;
let roomId: number;
let verificationId: number;
let uploadRoot: string;
const file = () => ({ mimetype: 'image/png', originalname: 'slip.png', buffer: crypto.randomBytes(32) });
const confirmed = (overrides: Partial<PaymentVerificationResult> = {}): PaymentVerificationResult => ({
  success: true, recipientMatched: true, duplicate: false, amount: 100,
  transactionId: crypto.randomUUID(), rawData: {}, ...overrides,
});
const isStatus = (status: number) => (error: unknown) => error instanceof AppError && error.statusCode === status;

before(async () => {
  for (const [key, value] of Object.entries({ contractDocLocation: 'QA Office', contractLandlordName: 'QA Landlord', contractLandlordAddress: 'QA Address', contractLandlordPhone: '0812345678', contractBuilding: 'QA Building', contractStartDate: '2026-09-01', contractEndDate: '2027-08-31', contractKeycardDeposit: '300', contractPayDueDate: '5', contractElectricityRate: '7', contractWaterRate: '18', contractAdvanceNoticeDays: '30' })) await prisma.systemSetting.upsert({ where: { key }, create: { key, value, category: 'CONTRACT' }, update: { value, category: 'CONTRACT' } });
  uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'housing-payment-test-'));
  process.env.UPLOAD_ROOT = uploadRoot;
  const user = await prisma.user.create({ data: { email: 'housing-test@example.test', phone: '0811111111', password: 'test-only', role: 'STUDENT' } });
  userId = user.id;
  const room = await prisma.room.create({ data: { roomNumber: '101', floor: 1, monthlyRent: 100, capacity: 4 } });
  roomId = room.id;
  const verification = await prisma.idCardVerification.create({ data: { userId, isThaiIdCard: true, idDetected: true, imagePath: 'uploads/private/id-cards/test.png', fullNameTh: 'ผู้สมัครทดสอบ' } });
  verificationId = verification.id;
});
after(async () => {
  await redis.disconnectRedis();
  await prisma.$disconnect();
  if (uploadRoot && path.dirname(uploadRoot) === path.resolve(os.tmpdir()) && path.basename(uploadRoot).startsWith('housing-payment-test-')) {
    await fs.rm(uploadRoot, { recursive: true, force: true });
  }
});

for (const [name, overrides] of [
  ['non-slip or unverified image', { success: false }],
  ['wrong recipient', { recipientMatched: false }],
  ['wrong amount', { amount: 50 }],
  ['duplicate transaction', { duplicate: true }],
  ['missing transaction reference', { transactionId: undefined }],
] as Array<[string, Partial<PaymentVerificationResult>]>) {
  test(`rejects ${name} and persists FAILED`, async (t) => {
    t.mock.method(PaymentProviderClient, 'verifySlip', async () => confirmed(overrides));
    const slip = file();
    await assert.rejects(HousingPaymentService.verifySlip('101', userId, slip, verificationId), isStatus(422));
    const record = await prisma.payment.findUnique({ where: { slipHash: crypto.createHash('sha256').update(slip.buffer).digest('hex') } });
    assert.equal(record?.status, 'FAILED');
  });
}

test('provider timeout stays pending manual review; retry does not call provider again', async (t) => {
  const mock = t.mock.method(PaymentProviderClient, 'verifySlip', async () => { throw new AppError('timeout', 503); });
  const slip = file();
  await assert.rejects(HousingPaymentService.verifySlip('101', userId, slip, verificationId), isStatus(503));
  await assert.rejects(HousingPaymentService.verifySlip('101', userId, slip, verificationId), isStatus(409));
  assert.equal(mock.mock.callCount(), 1);
  const record = await prisma.payment.findUnique({ where: { slipHash: crypto.createHash('sha256').update(slip.buffer).digest('hex') } });
  assert.equal(record?.status, 'MANUAL_REVIEW');
});

test('valid slip is persisted and same-owner retry reuses verification', async (t) => {
  const mock = t.mock.method(PaymentProviderClient, 'verifySlip', async () => confirmed());
  const slip = file();
  const first = await HousingPaymentService.verifySlip('101', userId, slip, verificationId);
  const second = await HousingPaymentService.verifySlip('101', userId, slip, verificationId);
  assert.equal(first.status, 'PAID');
  assert.equal(second.id, first.id);
  assert.equal(mock.mock.callCount(), 1);
  assert.deepEqual(await fs.readFile(path.join(uploadRoot, first.slipPath!.replace('uploads/private/', ''))), slip.buffer);
  const input = { paymentId: first.id, userId, verificationId, roomNumber: '101', slipPath: first.slipPath!, monthlyRent: '100', depositAmount: '100' };
  await HousingPaymentService.requireVerifiedPayment(prisma, input);
  for (const tampered of [{ userId: userId + 1 }, { verificationId: verificationId + 1 }, { roomNumber: '201' }, { slipPath: 'invented.png' }]) {
    await assert.rejects(HousingPaymentService.requireVerifiedPayment(prisma, { ...input, ...tampered }), isStatus(422));
  }
  await assert.rejects(HousingPaymentService.requireVerifiedPayment(prisma, { ...input, depositAmount: '1' }), isStatus(409));
  await prisma.room.update({ where: { id: roomId }, data: { monthlyRent: 200 } });
  await assert.rejects(HousingPaymentService.requireVerifiedPayment(prisma, input), isStatus(409));
  await prisma.room.update({ where: { id: roomId }, data: { monthlyRent: 100 } });
});

test('simultaneous upload of the same slip makes only one provider call', async (t) => {
  const mock = t.mock.method(PaymentProviderClient, 'verifySlip', async () => confirmed());
  const slip = file();
  const results = await Promise.allSettled([1, 2].map(() => HousingPaymentService.verifySlip('101', userId, slip, verificationId)));
  assert.ok(results.some(r => r.status === 'fulfilled'));
  assert.equal(mock.mock.callCount(), 1);
  assert.equal(await prisma.payment.count({ where: { slipHash: crypto.createHash('sha256').update(slip.buffer).digest('hex') } }), 1);
});

test('different image with the same transaction cannot pay a second time', async (t) => {
  const result = confirmed();
  t.mock.method(PaymentProviderClient, 'verifySlip', async () => result);
  await HousingPaymentService.verifySlip('101', userId, file(), verificationId);
  await assert.rejects(HousingPaymentService.verifySlip('101', userId, file(), verificationId), isStatus(409));
});

test('legacy bill reference stored in providerResponse blocks housing reuse', async (t) => {
  const tenant = await prisma.tenant.create({ data: { userId, roomId } });
  const bill = await prisma.bill.create({ data: { tenantId: tenant.id, amount: 100, dueDate: new Date() } });
  const result = confirmed();
  await prisma.payment.create({ data: { billId: bill.id, amount: 100, idempotencyKey: crypto.randomUUID(), status: 'PAID', providerResponse: JSON.stringify({ rawSlip: { transRef: result.transactionId } }) } });
  t.mock.method(PaymentProviderClient, 'verifySlip', async () => result);
  await assert.rejects(HousingPaymentService.verifySlip('101', userId, file(), verificationId), isStatus(409));
});

test('batch slips cannot be used for housing payments', async (t) => {
  const slip = file();
  await prisma.paymentBatch.create({ data: { payerUserId: userId, amount: 100, status: 'PAID', idempotencyKey: crypto.randomUUID(), slipHash: crypto.createHash('sha256').update(slip.buffer).digest('hex') } });
  const mock = t.mock.method(PaymentProviderClient, 'verifySlip', async () => confirmed());
  await assert.rejects(HousingPaymentService.verifySlip('101', userId, slip, verificationId), isStatus(409));
  assert.equal(mock.mock.callCount(), 0);
});

test('concurrent cross-table claims of the same reference have only one winner', async () => {
  const reference = crypto.randomUUID();
  const claims = await Promise.allSettled([
    prisma.$transaction(async tx => {
      const hash = crypto.randomUUID();
      await assertSlipAvailable(tx, hash, reference);
      return tx.payment.create({ data: { payerUserId: userId, housingRoomId: roomId, housingVerificationId: verificationId,
        amount: 100, idempotencyKey: crypto.randomUUID(), slipHash: hash, providerTransactionId: reference } });
    }),
    prisma.$transaction(async tx => {
      const hash = crypto.randomUUID();
      await assertSlipAvailable(tx, hash, reference);
      return tx.paymentBatch.create({ data: { payerUserId: userId, amount: 100,
        idempotencyKey: crypto.randomUUID(), slipHash: hash, providerTransactionId: reference } });
    }),
  ]);
  assert.equal(claims.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(claims.filter(r => r.status === 'rejected').length, 1);
});

test('HTTP upload rejects a non-slip; verified upload then apply requires the bound payment', async (t) => {
  process.env.JWT_SECRET = 'isolated-housing-test-secret';
  await fs.mkdir(path.join(uploadRoot, 'id-cards'), { recursive: true });
  await fs.writeFile(path.join(uploadRoot, 'id-cards/test.png'), 'test-id-card');
  t.mock.method(OcrService, 'verifyIdCard', async () => ({
    verificationId, imagePath: 'uploads/private/id-cards/test.png', isThaiIdCard: true,
    confidence: { idDetected: true, idPresent: true, idChecksumValid: true },
    fullNameTh: 'ผู้สมัครทดสอบ', citizenId: '1234567890123', address: 'ที่อยู่ทดสอบ',
  }));
  let accept = false;
  t.mock.method(PaymentProviderClient, 'verifySlip', async () => confirmed({ success: accept }));
  const app = express();
  app.use(express.json());
  app.use('/api/tenants', tenantsRoutes);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const token = jwt.sign({ id: userId, role: 'STUDENT', sessionVersion: 1 }, process.env.JWT_SECRET);
  const headers = { Authorization: `Bearer ${token}` };
  const upload = () => {
    const form = new FormData();
    form.append('roomNumber', '101');
    form.append('idCard', new Blob(['test-id'], { type: 'image/png' }), 'id.png');
    form.append('paymentSlip', new Blob([crypto.randomUUID()], { type: 'image/png' }), 'slip.png');
    return fetch(`${origin}/api/tenants/upload-documents`, { method: 'POST', headers, body: form });
  };
  try {
    const failed = await upload();
    assert.equal(failed.status, 422);
    assert.equal((await failed.json()).statusCode, 422);
    accept = true;
    const response = await upload();
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.paymentVerification.status, 'PAID');
    const contract = Object.fromEntries(Object.keys(requiredContractFields).map(key => [key, 'test']));
    Object.assign(contract, { tenantName: 'ผู้สมัครทดสอบ', tenantCitizenId: '1234567890123', tenantAge: '20', roomNumber: '101', monthlyRent: '100', depositAmount: '100' });
    const application = {
      contractAccepted: true, personalInformation: { birthDate: '2000-01-15', citizenId: '1234567890123', address: 'QA Address', fullName: 'ผู้สมัครทดสอบ', studentId: 'test', course: 'test', yearLevel: '1', contactNumber: '0812345678', emailAddress: 'test@example.test' },
      emergencyContact: { emergencyName: 'test', relationship: 'test', emergencyNumber: '0812345678' },
      roomPreference: { preferredRoomType: 'Floor 1', roomNumber: '101' },
      ocrData: data.ocrData, idCardImagePath: data.idCardImagePath, paymentSlipPath: data.paymentSlipPath,
      contractData: { ...contract, ...await getContractTerms(await prisma.room.findUniqueOrThrow({ where: { id: roomId } })) },
    };
    const apply = (body: object) => fetch(`${origin}/api/tenants/apply`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const unverified = await apply(application);
    assert.equal(unverified.status, 400);
    const payload = { ...application, paymentId: data.paymentVerification.id };
    const applied = await apply(payload);
    assert.equal(applied.status, 201);
    const tenant = (await applied.json()).data;
    const repeated = await apply(payload);
    assert.equal(repeated.status, 201);
    assert.equal((await repeated.json()).data.id, tenant.id);
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: payload.paymentId } })).housingTenantId, tenant.id);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('single-bill and batch payments still work and reject references already used for housing', async (t) => {
  for (const key of ['PAYMENT_BANK_NAME', 'PAYMENT_ACCOUNT_NAME', 'PAYMENT_ACCOUNT_NUMBER', 'PAYMENT_PROMPTPAY_NUMBER']) process.env[key] = 'test-only';
  t.mock.method(redis, 'acquireLock', async () => true);
  t.mock.method(redis, 'releaseLock', async () => undefined);
  let result = confirmed();
  t.mock.method(PaymentProviderClient, 'verifySlip', async () => result);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { userId } });
  const makeBill = () => prisma.bill.create({ data: { tenantId: tenant.id, amount: 100, dueDate: new Date() } });
  const bill = await makeBill();
  const single = await BillingService.verifyPaymentSlip(bill.id, userId, crypto.randomUUID(), file());
  assert.equal(single.billStatus, 'PAID');
  assert.equal(single.payment.providerTransactionId, result.transactionId);
  result = confirmed();
  const batchBill = await makeBill();
  const batch = await PaymentBatchService.create(userId, [batchBill.id], crypto.randomUUID());
  assert.equal((await PaymentBatchService.uploadSlip(batch.id, userId, file())).status, 'PAID');
  const housing = await prisma.payment.findFirstOrThrow({ where: { housingRoomId: roomId, status: 'PAID', providerTransactionId: { not: null } } });
  result = confirmed({ transactionId: housing.providerTransactionId! });
  const duplicateBill = await makeBill();
  await assert.rejects(BillingService.verifyPaymentSlip(duplicateBill.id, userId, crypto.randomUUID(), file()), isStatus(409));
  assert.equal((await prisma.bill.findUniqueOrThrow({ where: { id: duplicateBill.id } })).status, 'FAILED');
  const duplicateBatchBill = await makeBill();
  const duplicateBatch = await PaymentBatchService.create(userId, [duplicateBatchBill.id], crypto.randomUUID());
  await assert.rejects(PaymentBatchService.uploadSlip(duplicateBatch.id, userId, file()), isStatus(409));
  assert.equal((await prisma.paymentBatch.findUniqueOrThrow({ where: { id: duplicateBatch.id } })).status, 'FAILED');
});

const capacityRoom = () => prisma.room.create({ data: {
  roomNumber: `QA-${crypto.randomUUID().slice(0, 8)}`, capacity: 4, floor: 1, monthlyRent: 100,
} });
const applicationFor = async (room: { id: number; roomNumber: string }, existingUserId?: number): Promise<SubmitApplicationInput> => {
  const applicantId = existingUserId ?? (await prisma.user.create({ data: {
    email: `${crypto.randomUUID()}@example.test`, phone: `082${crypto.randomInt(1000000, 10000000)}`, password: 'test-only', role: 'STUDENT',
  } })).id;
  const name = crypto.randomUUID();
  await fs.mkdir(path.join(uploadRoot, 'id-cards'), { recursive: true });
  await fs.mkdir(path.join(uploadRoot, 'payment-slips'), { recursive: true });
  await fs.writeFile(path.join(uploadRoot, 'id-cards', `${name}.png`), 'test-only');
  await fs.writeFile(path.join(uploadRoot, 'payment-slips', `${name}.png`), 'test-only');
  const idCardImagePath = `uploads/private/id-cards/${name}.png`;
  const paymentSlipPath = `uploads/private/payment-slips/${name}.png`;
  const verification = await prisma.idCardVerification.create({ data: {
    userId: applicantId, isThaiIdCard: true, idDetected: true, imagePath: idCardImagePath, fullNameTh: 'QA',
  } });
  // Bound, verified evidence exists only in this disposable database; no bank call.
  const payment = await prisma.payment.create({ data: {
    payerUserId: applicantId, housingRoomId: room.id, housingVerificationId: verification.id,
    amount: 100, status: 'PAID', providerTransactionId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(), slipPath: paymentSlipPath,
  } });
  const contract = Object.fromEntries(Object.keys(requiredContractFields).map(key => [key, 'test']));
  Object.assign(contract, { tenantCitizenId: '1234567890123', tenantAge: '20',
    tenantName: 'QA', roomNumber: room.roomNumber, monthlyRent: '100', depositAmount: '100' });
  return {
    userId: applicantId, paymentId: payment.id, ocrData: { verificationId: verification.id },
    contractAccepted: true, personalInformation: { birthDate: '2000-01-15', citizenId: '1234567890123', address: 'QA Address', fullName: 'QA', studentId: 'QA', course: 'QA', yearLevel: '1', emailAddress: 'qa@example.test' },
    emergencyContact: { emergencyName: 'QA', relationship: 'QA', emergencyNumber: '0812345678' },
    roomPreference: { preferredRoomType: 'Floor 1', roomNumber: room.roomNumber },
    contractData: { ...contract, ...await getContractTerms({ ...room, floor: 1, monthlyRent: 100 }) }, idCardImagePath, paymentSlipPath,
  };
};
const reserveThreePlaces = (id: number) => prisma.tenant.createMany({ data:
  ['PENDING', 'APPROVED', 'ACTIVE'].map(status => ({ roomId: id, status, isActive: true })),
});

for (const mode of ['admin/admin', 'application/application', 'admin/application'] as const) {
  test(`${mode}: concurrent requests cannot take the last place twice`, async () => {
    const room = await capacityRoom();
    await reserveThreePlaces(room.id);
    const first = mode === 'application/application' ? await applicationFor(room) : null;
    const second = mode !== 'admin/admin' ? await applicationFor(room) : null;
    const results = await Promise.allSettled([
      first ? TenantsService.submitApplication(first) : TenantsService.createTenant({ roomId: room.id }),
      second ? TenantsService.submitApplication(second) : TenantsService.createTenant({ roomId: room.id }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    for (const result of results) {
      if (result.status === 'rejected') assert.ok(result.reason instanceof AppError && result.reason.statusCode === 409);
    }
    assert.equal(await prisma.tenant.count({ where: { ...ROOM_RESERVATION_FILTER, roomId: room.id } }), 4);
    assert.equal((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).status, 'OCCUPIED');
  });
}

test('inactive and rejected history does not consume a place or block QR generation', async (t) => {
  const room = await capacityRoom();
  await prisma.room.update({ where: { id: room.id }, data: { status: 'OCCUPIED' } });
  await prisma.tenant.createMany({ data: [
    { roomId: room.id, status: 'ACTIVE', isActive: false },
    { roomId: room.id, status: 'INACTIVE', isActive: true },
    { roomId: room.id, status: 'REJECTED', isActive: true },
    { roomId: room.id, status: 'REJECTED', isActive: true },
  ] });
  t.mock.method(PaymentProviderClient, 'generateQr', async () => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal((await HousingPaymentService.generateQr(room.roomNumber)).amount, 100);
  const tenant = await TenantsService.createTenant({ roomId: room.id, status: 'ACTIVE' });
  assert.equal(tenant.status, 'ACTIVE');
  assert.equal(await prisma.tenant.count({ where: { ...ROOM_RESERVATION_FILTER, roomId: room.id } }), 1);
});

test('resubmitting a pending application in a full room preserves its own place and is idempotent', async () => {
  const room = await capacityRoom();
  await reserveThreePlaces(room.id);
  const application = await applicationFor(room);
  const pending = await TenantsService.createTenant({ userId: application.userId, roomId: room.id });
  const submitted = await TenantsService.submitApplication(application);
  assert.equal(submitted.id, pending.id);
  assert.equal((await TenantsService.submitApplication(application)).id, pending.id);
  assert.equal(await prisma.tenant.count({ where: { roomId: room.id } }), 4);
});

test('moving a pending application releases the old place and fills the new room atomically', async () => {
  const old = await capacityRoom();
  const next = await capacityRoom();
  await reserveThreePlaces(old.id);
  await reserveThreePlaces(next.id);
  const application = await applicationFor(next);
  const pending = await TenantsService.createTenant({ userId: application.userId, roomId: old.id });
  assert.equal((await prisma.room.findUniqueOrThrow({ where: { id: old.id } })).status, 'OCCUPIED');
  const submitted = await TenantsService.submitApplication(application);
  assert.equal(submitted.id, pending.id);
  assert.equal(submitted.roomId, next.id);
  assert.equal((await prisma.room.findUniqueOrThrow({ where: { id: old.id } })).status, 'AVAILABLE');
  assert.equal((await prisma.room.findUniqueOrThrow({ where: { id: next.id } })).status, 'OCCUPIED');
});

test('failed full-room application rolls back the applicant version and payment binding', async () => {
  const room = await capacityRoom();
  await reserveThreePlaces(room.id);
  await TenantsService.createTenant({ roomId: room.id });
  const application = await applicationFor(room);
  const beforeUser = await prisma.user.findUniqueOrThrow({ where: { id: application.userId } });
  await assert.rejects(TenantsService.submitApplication(application), isStatus(409));
  assert.equal(await prisma.tenant.findUnique({ where: { userId: application.userId } }), null);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: application.userId } })).version, beforeUser.version);
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: application.paymentId } })).housingTenantId, null);
});

for (const status of ['MAINTENANCE', 'INACTIVE']) {
  test(`admin creation rejects a ${status} room without saving a tenant`, async () => {
    const room = await capacityRoom();
    await prisma.room.update({ where: { id: room.id }, data: { status } });
    await assert.rejects(TenantsService.createTenant({ roomId: room.id }), isStatus(409));
    assert.equal(await prisma.tenant.count({ where: { roomId: room.id } }), 0);
    assert.equal((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).status, status);
  });
}

test('rejecting a reservation frees one place and permits physical deletion', async () => {
  const room = await capacityRoom();
  await reserveThreePlaces(room.id);
  const tenant = await TenantsService.createTenant({ roomId: room.id });
  await assert.rejects(TenantsService.deleteTenant(tenant.id), isStatus(409));
  await TenantsService.updateTenant(tenant.id, { status: 'REJECTED' });
  await TenantsService.deleteTenant(tenant.id);
  assert.equal(await prisma.tenant.findUnique({ where: { id: tenant.id } }), null);
  assert.equal((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).status, 'AVAILABLE');
  assert.equal(await prisma.tenant.count({ where: { ...ROOM_RESERVATION_FILTER, roomId: room.id } }), 3);
});

test('updating a pending application preserves its reserved place until rejection', async () => {
  const room = await capacityRoom();
  await reserveThreePlaces(room.id);
  const tenant = await TenantsService.createTenant({ roomId: room.id });
  const updated = await TenantsService.updateTenant(tenant.id, { status: 'PENDING', fullName: 'Updated QA' });
  assert.equal(updated.roomId, room.id);
  assert.equal((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).status, 'OCCUPIED');
  await TenantsService.updateTenant(tenant.id, { status: 'REJECTED' });
  assert.equal((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).status, 'AVAILABLE');
});

test('QR, admin creation and application all enforce the configured occupant limit', async () => {
  const room = await capacityRoom();
  await prisma.tenant.createMany({ data: [1, 2].map(() => ({ roomId: room.id, status: 'ACTIVE' })) });
  const application = await applicationFor(room);
  await prisma.systemSetting.create({ data: { key: 'maxOccupants', value: '2', category: 'DORMITORY' } });
  try {
    await assert.rejects(HousingPaymentService.generateQr(room.roomNumber), isStatus(409));
    await assert.rejects(TenantsService.createTenant({ roomId: room.id }), isStatus(409));
    await assert.rejects(TenantsService.submitApplication(application), isStatus(409));
    assert.equal(await prisma.tenant.count({ where: { roomId: room.id } }), 2);
  } finally {
    await prisma.systemSetting.delete({ where: { key: 'maxOccupants' } });
  }
});

test('legacy OCCUPIED flag does not block verified upload or application when places remain', async (t) => {
  const room = await capacityRoom();
  const application = await applicationFor(room);
  await prisma.room.update({ where: { id: room.id }, data: { status: 'OCCUPIED' } });
  t.mock.method(PaymentProviderClient, 'verifySlip', async () => confirmed());
  assert.equal((await HousingPaymentService.verifySlip(room.roomNumber, application.userId!, file(), application.ocrData!.verificationId!)).status, 'PAID');
  assert.equal((await TenantsService.submitApplication(application)).roomId, room.id);
  assert.equal((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).status, 'AVAILABLE');
});
