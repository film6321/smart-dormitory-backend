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
  uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'housing-payment-test-'));
  process.env.UPLOAD_ROOT = uploadRoot;
  const user = await prisma.user.create({ data: { email: 'housing-test@example.test', password: 'test-only', role: 'STUDENT' } });
  userId = user.id;
  const room = await prisma.room.create({ data: { roomNumber: '101', floor: 1, monthlyRent: 100, capacity: 4 } });
  roomId = room.id;
  const verification = await prisma.idCardVerification.create({ data: { userId, isThaiIdCard: true, idDetected: true, imagePath: 'uploads/private/id-cards/test.png' } });
  verificationId = verification.id;
});
after(async () => {
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
  const token = jwt.sign({ id: userId, role: 'STUDENT' }, process.env.JWT_SECRET);
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
    Object.assign(contract, { tenantCitizenId: '1234567890123', tenantAge: '20', roomNumber: '101', monthlyRent: '100', depositAmount: '100' });
    const application = {
      personalInformation: { fullName: 'test', studentId: 'test', course: 'test', yearLevel: '1', contactNumber: '0812345678', emailAddress: 'test@example.test' },
      emergencyContact: { emergencyName: 'test', relationship: 'test', emergencyNumber: '0812345678' },
      roomPreference: { preferredRoomType: 'Floor 1', roomNumber: '101' },
      ocrData: data.ocrData, idCardImagePath: data.idCardImagePath, paymentSlipPath: data.paymentSlipPath,
      contractData: contract,
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
