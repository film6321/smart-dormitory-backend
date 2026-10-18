import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../../src/database/db';
import { HousingDraftService } from '../../src/modules/tenants/housing-draft.service';
import { HousingPaymentService } from '../../src/modules/tenants/housing-payment.service';
import { TenantsService } from '../../src/modules/tenants/tenants.service';
import { RoomsService } from '../../src/modules/rooms/rooms.service';
import { PaymentProviderClient } from '../../src/modules/billing/payment.provider';
import { AppError } from '../../src/middlewares/error-handler';
import { getContractTerms } from '../../src/modules/settings/settings.service';
import { HousingRefundService } from '../../src/modules/tenants/housing-refund.service';
import { AccountRetentionService } from '../../src/modules/users/account-retention.service';
import * as cache from '../../src/shared/cache';
import { AuthRepository } from '../../src/modules/auth/auth.repository';
import { AuthService } from '../../src/modules/auth/auth.service';
import bcrypt from 'bcrypt';
import * as presence from '../../src/shared/presence';

if (new URL(process.env.DATABASE_URL!).pathname !== '/housing_room_hold_test') {
  throw new Error('Requires the isolated housing_room_hold_test database');
}
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let uploadRoot: string;
before(async () => {
  uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'housing-room-hold-'));
  process.env.UPLOAD_ROOT = uploadRoot;
  const terms = { contractDocLocation: 'QA Office', contractLandlordName: 'QA Landlord', contractLandlordAddress: 'QA Address',
    contractLandlordPhone: '0812345678', contractBuilding: 'QA Building', contractKeycardDeposit: '300',
    contractPayDueDate: '5', contractElectricityRate: '7', contractWaterRate: '18', contractAdvanceNoticeDays: '30', maxOccupants: '4' };
  for (const [key, value] of Object.entries(terms)) {
    const category = key.startsWith('contract') ? 'CONTRACT' : 'GENERAL';
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value, category }, update: { value, category } });
  }
});
after(async () => { await prisma.$disconnect(); if (uploadRoot && path.dirname(uploadRoot) === path.resolve(os.tmpdir())
  && path.basename(uploadRoot).startsWith('housing-room-hold-')) await fs.rm(uploadRoot, { recursive: true, force: true }); });

async function fixture() {
  const room = await prisma.room.create({ data: { roomNumber: crypto.randomUUID().slice(0, 8), floor: 1, capacity: 1, monthlyRent: 100 } });
  const users = await Promise.all([1, 2].map(() => prisma.user.create({ data: { email: `${crypto.randomUUID()}@example.test`, password: 'fixture', role: 'STUDENT' } })));
  const drafts = await Promise.all(users.map(user => prisma.housingApplicationDraft.create({ data: { userId: user.id, roomId: room.id } })));
  return { room, users, drafts };
}
const conflict = (error: unknown) => error instanceof AppError && error.statusCode === 409;

test('real concurrent login increments session atomically and only the newest token survives', async t => {
  const env = await fixture(); const user = env.users[0];
  t.mock.method(presence, 'markUserOnline', async () => {});
  const hash = await bcrypt.hash('Qa-only-password-123', 4);
  await prisma.user.update({ where: { id: user.id }, data: { password: hash } });
  const sessions = await Promise.all([1, 2].map(() => AuthService.login(user.email, 'Qa-only-password-123')));
  const checks = await Promise.allSettled(sessions.map(session => AuthService.authenticateToken(session.token)));
  assert.equal(checks.filter(check => check.status === 'fulfilled').length, 1);
  const persisted = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(persisted.authSessionVersion, user.authSessionVersion + 2);
  assert.equal(persisted.version, user.version);
  await assert.rejects(AuthRepository.startLoginSession(user.id, 'outdated-password-hash', new Date()));
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).authSessionVersion, persisted.authSessionVersion);
});

test('an unavailable saved room does not prevent saving personal data; another unavailable room is rejected', async () => {
  const env = await fixture(); const other = await fixture();
  for (const room of [env.room, other.room]) await prisma.room.update({ where: { id: room.id }, data: { status: 'MAINTENANCE' } });
  const saved = await HousingDraftService.save(env.users[0].id, 1, { activeStep: 0, personalInformation: { firstName: 'edited' } }, env.room.roomNumber);
  assert.equal(saved.version, 2);
  await assert.rejects(HousingDraftService.save(env.users[0].id, 2, {}, other.room.roomNumber), conflict);
  await assert.rejects(HousingDraftService.save(env.users[0].id, 1, {}), conflict);
});

test('inactive resident receives an explicit block until personal records are purged', async () => {
  const env = await fixture();
  await prisma.tenant.create({ data: { userId: env.users[0].id, status: 'INACTIVE' } });
  assert.ok((await HousingDraftService.get(env.users[0].id)).applicationBlockedReason);
  await assert.rejects(HousingDraftService.save(env.users[0].id, 1, {}), conflict);
});

test('refund requests hold credit until Admin rejects or records the actual refund', async t => {
  t.mock.method(cache, 'deleteCacheByPattern', async () => undefined);
  t.mock.method(PaymentProviderClient, 'generateQr', async () => png);
  const env = await fixture(); const user = env.users[0];
  const admin = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@example.test`, password: 'fixture', role: 'ADMIN' } });
  const verification = await prisma.idCardVerification.create({ data: { userId: user.id, isThaiIdCard: true, idDetected: true } });
  await HousingPaymentService.generateDraftQr(user.id, env.room.roomNumber);
  assert.ok((await prisma.housingApplicationDraft.findUniqueOrThrow({ where: { id: env.drafts[0].id } })).roomHoldExpiresAt);
  const payment = await prisma.payment.create({ data: { payerUserId: user.id, housingDraftId: env.drafts[0].id,
    housingRoomId: env.room.id, housingVerificationId: verification.id, amount: 150, providerTransactionId: crypto.randomUUID(), slipPath: 'fixture-refund.png', idempotencyKey: crypto.randomUUID(), status: 'PAID' } });
  const request = await HousingRefundService.request(user.id, 'ไม่ประสงค์ดำเนินการสมัครต่อ');
  assert.equal(request.status, 'PENDING'); assert.equal(request.amount, 150);
  assert.equal((await HousingDraftService.get(user.id)).roomHoldExpiresAt, null);
  await assert.rejects(HousingDraftService.save(user.id, 2, {}), conflict);
  await assert.rejects(HousingPaymentService.generateDraftQr(user.id, env.room.roomNumber), conflict);
  await HousingRefundService.reject(env.drafts[0].id, request.id, admin.id, 'กรุณาตรวจสอบข้อมูลบัญชีรับเงิน');
  let summary = await HousingDraftService.get(user.id);
  assert.equal(summary.paidAmount, 150); assert.equal(summary.refundRequest?.status, 'REJECTED');
  await HousingDraftService.save(user.id, summary.version, {});
  const retryRequest = await HousingRefundService.request(user.id);
  assert.equal(retryRequest.status, 'PENDING');
  const pending = await HousingDraftService.get(user.id);
  const input = { version: pending.version, amount: 150, reference: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
  const proof = { buffer: Buffer.concat([png, crypto.randomBytes(32)]), mimetype: 'image/png' };
  const refund = await HousingRefundService.record(env.drafts[0].id, admin.id, input, proof);
  summary = await HousingDraftService.get(user.id);
  assert.equal(summary.grossPaidAmount, 150); assert.equal(summary.refundedAmount, 150); assert.equal(summary.paidAmount, 0);
  assert.equal(summary.refundRequest?.status, 'COMPLETED');
  assert.equal(Number((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).amount), 150);
  assert.deepEqual(await fs.readFile(await HousingRefundService.proof(refund.id)), proof.buffer);
  assert.equal(await prisma.housingRefund.count({ where: { draftId: env.drafts[0].id } }), 1);
  const proofPath = await HousingRefundService.proof(refund.id);
  const tenant = await prisma.tenant.create({ data: { userId: user.id, status: 'REJECTED' } });
  await AccountRetentionService.deleteTenant(tenant.id);
  assert.equal(await prisma.housingRefund.count({ where: { draftId: env.drafts[0].id } }), 0);
  assert.equal(await prisma.housingRefundRequest.count({ where: { draftId: env.drafts[0].id } }), 0);
  assert.equal(await prisma.user.count({ where: { id: user.id } }), 1);
  await AccountRetentionService.flushFiles();
  await assert.rejects(fs.stat(proofPath), { code: 'ENOENT' });
});
test('simultaneous QR requests for the last place have exactly one winner and one provider call', async t => {
  const env = await fixture();
  const provider = t.mock.method(PaymentProviderClient, 'generateQr', async () => png);
  const result = await Promise.allSettled(env.users.map(user => HousingPaymentService.generateDraftQr(user.id, env.room.roomNumber)));
  assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
  const winner = result.find(item => item.status === 'fulfilled');
  assert.ok(winner?.status === 'fulfilled');
  const duration = winner.value.reservationExpiresAt.getTime() - winner.value.serverTime.getTime();
  assert.ok(duration > 590000 && duration <= 600000, 'new holds last ten minutes');
  const loser = result.find(item => item.status === 'rejected');
  assert.ok(loser?.status === 'rejected' && conflict(loser.reason));
  assert.equal(provider.mock.callCount(), 1);
  assert.equal(await prisma.housingApplicationDraft.count({ where: { roomId: env.room.id, roomHoldExpiresAt: { not: null } } }), 1);
});

test('retry and concurrent tabs of the same user reuse the hold without extending its expiry', async t => {
  const env = await fixture(); t.mock.method(PaymentProviderClient, 'generateQr', async () => png);
  const responses = await Promise.all([1, 2, 3].map(() => HousingPaymentService.generateDraftQr(env.users[0].id, env.room.roomNumber)));
  assert.equal(new Set(responses.map(result => result.reservationExpiresAt.toISOString())).size, 1);
  assert.equal((await prisma.housingApplicationDraft.findUniqueOrThrow({ where: { id: env.drafts[0].id } })).version, 1);
});

test('unpaid expired hold releases the last place; a new QR cannot steal it back', async t => {
  const env = await fixture(); t.mock.method(PaymentProviderClient, 'generateQr', async () => png);
  await HousingPaymentService.generateDraftQr(env.users[0].id, env.room.roomNumber);
  await prisma.housingApplicationDraft.update({ where: { id: env.drafts[0].id }, data: { roomHoldExpiresAt: new Date(0) } });
  await HousingPaymentService.generateDraftQr(env.users[1].id, env.room.roomNumber);
  await assert.rejects(HousingPaymentService.generateDraftQr(env.users[0].id, env.room.roomNumber), conflict);
});

test('expired holds release room capacity even when payment evidence remains with the applicant', async t => {
  t.mock.method(PaymentProviderClient, 'generateQr', async () => png);
  for (const state of ['VERIFYING', 'MANUAL_REVIEW', 'PAID', 'PROVIDER_PENDING']) {
    const env = await fixture(); await HousingPaymentService.generateDraftQr(env.users[0].id, env.room.roomNumber);
    await prisma.housingApplicationDraft.update({ where: { id: env.drafts[0].id }, data: { roomHoldExpiresAt: new Date(0) } });
    const verification = await prisma.idCardVerification.create({ data: { userId: env.users[0].id, isThaiIdCard: true, idDetected: true } });
    await prisma.payment.create({ data: { payerUserId: env.users[0].id, housingDraftId: env.drafts[0].id, housingRoomId: env.room.id,
      housingVerificationId: verification.id,
      amount: 100, idempotencyKey: crypto.randomUUID(), status: state === 'PROVIDER_PENDING' ? 'FAILED' : state as 'VERIFYING' | 'MANUAL_REVIEW' | 'PAID',
      failureReason: state === 'PROVIDER_PENDING' ? 'PROVIDER_PENDING' : null } });
    const previousDraft = await HousingDraftService.get(env.users[0].id);
    assert.equal(previousDraft.roomHoldExpiresAt, null);
    if (state === 'PAID') assert.equal(previousDraft.paidAmount, 100);
    await HousingPaymentService.generateDraftQr(env.users[1].id, env.room.roomNumber);
    assert.equal(await prisma.$transaction(tx => HousingDraftService.heldPlaces(tx, env.room.id)), 1);
  }
});

test('Admin create and move cannot take the place reserved for another user', async t => {
  const env = await fixture(); t.mock.method(PaymentProviderClient, 'generateQr', async () => png);
  await HousingPaymentService.generateDraftQr(env.users[0].id, env.room.roomNumber);
  await assert.rejects(TenantsService.createTenant({ roomId: env.room.id }), conflict);
  const tenant = await TenantsService.createTenant({ userId: env.users[1].id });
  await assert.rejects(TenantsService.updateTenant(tenant.id, { roomId: env.room.id }), conflict);
  assert.equal((await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).roomId, null);
  await assert.rejects(RoomsService.updateRoom(env.room.id, { status: 'MAINTENANCE' }), conflict);
  await assert.rejects(RoomsService.updateRoom(env.room.id, { roomNumber: 'renamed' }), conflict);
  await assert.rejects(RoomsService.deleteRoom(env.room.id), conflict);
});

test('room changes release the previous hold without changing verified credit', async t => {
  const env = await fixture(); const destination = await fixture(); t.mock.method(PaymentProviderClient, 'generateQr', async () => png);
  await HousingPaymentService.generateDraftQr(env.users[0].id, env.room.roomNumber);
  const changed = await HousingDraftService.save(env.users[0].id, 1, {}, destination.room.roomNumber);
  assert.equal(changed.roomHoldExpiresAt, null);
  await HousingPaymentService.generateDraftQr(env.users[1].id, env.room.roomNumber);
});

test('late genuine slip becomes durable credit without taking another users place or calling provider twice', async t => {
  const env = await fixture(); t.mock.method(PaymentProviderClient, 'generateQr', async () => png);
  await HousingPaymentService.generateDraftQr(env.users[0].id, env.room.roomNumber);
  await prisma.housingApplicationDraft.update({ where: { id: env.drafts[0].id }, data: { roomHoldExpiresAt: new Date(0) } });
  await HousingPaymentService.generateDraftQr(env.users[1].id, env.room.roomNumber);
  const verification = await prisma.idCardVerification.create({ data: { userId: env.users[0].id, isThaiIdCard: true, idDetected: true, imagePath: 'fixture.png', fullNameTh: 'fixture' } });
  const provider = t.mock.method(PaymentProviderClient, 'verifySlip', async () => ({ success: true, recipientMatched: true,
    duplicate: false, amount: 100, transactionId: crypto.randomUUID(), rawData: {} }));
  const file = { buffer: crypto.randomBytes(32), mimetype: 'image/png' };
  const payment = await HousingPaymentService.verifyDraftSlip(env.room.roomNumber, env.users[0].id, file, verification.id);
  assert.equal(payment.status, 'PAID'); assert.equal(Number(payment.amount), 100);
  assert.equal((await HousingDraftService.get(env.users[0].id)).roomHoldExpiresAt, null);
  assert.ok((await HousingDraftService.get(env.users[1].id)).roomHoldExpiresAt);
  const retry = await HousingPaymentService.verifyDraftSlip(env.room.roomNumber, env.users[0].id, file, verification.id);
  assert.equal(retry.id, payment.id); assert.equal(provider.mock.callCount(), 1);
  const winnerVerification = await prisma.idCardVerification.create({ data: { userId: env.users[1].id, isThaiIdCard: true, idDetected: true, imagePath: 'winner.png', fullNameTh: 'fixture' } });
  const winnerPayment = await HousingPaymentService.verifyDraftSlip(env.room.roomNumber, env.users[1].id,
    { buffer: crypto.randomBytes(32), mimetype: 'image/png' }, winnerVerification.id);
  const applications = await Promise.all([verification, winnerVerification].map(async (identity, index) => {
    const phone = `08${String(env.users[index].id).padStart(8, '0')}`;
    await prisma.user.update({ where: { id: env.users[index].id }, data: { phone } });
    const identityPath = `uploads/private/id-cards/hold-${identity.id}.png`;
    await fs.mkdir(path.join(uploadRoot, 'id-cards'), { recursive: true });
    await fs.writeFile(path.join(uploadRoot, 'id-cards', `hold-${identity.id}.png`), 'synthetic');
    await prisma.idCardVerification.update({ where: { id: identity.id }, data: { imagePath: identityPath } });
    const terms = await getContractTerms(env.room);
    const transfer = index === 0 ? payment : winnerPayment;
    return { userId: env.users[index].id, contractAccepted: true,
      personalInformation: { fullName: 'fixture', studentId: 'fixture-1', course: 'fixture', yearLevel: '1st Year',
        citizenId: '1234567890123', address: 'fixture address', birthDate: '2000-01-15' },
      emergencyContact: { emergencyName: 'fixture', relationship: 'Parent', emergencyNumber: '0812345678' },
      roomPreference: { roomNumber: env.room.roomNumber, preferredRoomType: 'Any Floor' }, ocrData: { verificationId: identity.id },
      paymentId: transfer.id, idCardImagePath: identityPath, paymentSlipPath: transfer.slipPath!,
      contractData: { ...terms, tenantName: 'fixture', tenantAge: '26', tenantCitizenId: '1234567890123', tenantAddress: 'fixture address' } };
  }));
  const submitted = await Promise.allSettled(applications.map(application => TenantsService.submitApplication(application)));
  assert.equal(submitted[0].status, 'rejected'); assert.equal(submitted[1].status, 'fulfilled');
  assert.equal(await prisma.tenant.count({ where: { roomId: env.room.id } }), 1);
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).housingTenantId, null);
  assert.equal(Number((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).amount), 100);
  assert.equal((await HousingDraftService.get(env.users[1].id)).roomHoldExpiresAt, null);
});

test('Admin and QR racing for the last place cannot both win', async t => {
  const env = await fixture(); t.mock.method(PaymentProviderClient, 'generateQr', async () => png);
  const results = await Promise.allSettled([
    HousingPaymentService.generateDraftQr(env.users[0].id, env.room.roomNumber),
    TenantsService.createTenant({ roomId: env.room.id }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const occupants = await prisma.tenant.count({ where: { roomId: env.room.id } });
  const holds = await prisma.$transaction(tx => HousingDraftService.heldPlaces(tx, env.room.id));
  assert.equal(occupants + holds, 1);
});

