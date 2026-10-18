import * as settings from '../../src/modules/settings/settings.service';
import fs from 'fs/promises';
import { createHash } from 'crypto';
import type { DbClient } from '../../src/database/db';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/database/db';
import { TenantsService, type SubmitApplicationInput } from '../../src/modules/tenants/tenants.service';
import { HousingPaymentService } from '../../src/modules/tenants/housing-payment.service';
import { OcrService } from '../../src/modules/ocr/ocr.service';
import { requiredContractFields, validateHousingApplication } from '../../src/modules/tenants/tenants.dto';
import { AppError } from '../../src/middlewares/error-handler';
import { HousingDraftService } from '../../src/modules/tenants/housing-draft.service';
import type { Prisma } from '@prisma/client';

function rejectedDraftFixture(status = 'REJECTED', paymentOverrides: Record<string, unknown> = {}) {
  let draft = { id: 3, userId: 25, status: 'SUBMITTED', version: 8, roomId: 1,
    data: { activeStep: 3, personalInformation: { firstName: 'fixture' } } };
  const payment = { payerUserId: 25, housingTenantId: 7 as number | null, housingApprovedAt: null,
    billId: null, status: 'PAID', amount: 100, providerTransactionId: 'fixture-txn', ...paymentOverrides };
  const writes: unknown[] = [];
  const tx = {
    $queryRaw: async () => [], user: { findUnique: async () => ({ id: 25 }) },
    tenant: { findUnique: async () => ({ id: 7, userId: 25, status }) },
    housingApplicationDraft: { findUnique: async () => draft,
      update: async ({ data }: { data: { status: string; data: typeof draft.data } }) => {
        writes.push(data); draft = { ...draft, status: data.status, data: data.data, version: draft.version + 1 }; return draft;
      } },
    payment: { findMany: async () => [payment], findFirst: async () => null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if ('housingTenantId' in data) {
          assert.deepEqual(where, { housingDraftId: 3, payerUserId: 25, housingTenantId: 7,
            billId: null, housingApprovedAt: null, status: 'PAID' });
          assert.deepEqual(data, { housingTenantId: null }); payment.housingTenantId = null; writes.push(data);
        }
        return { count: 1 };
      } },
  } as unknown as Prisma.TransactionClient;
  return { tx, payment, writes };
}

test('rejected submitted draft reopens at the first step once and keeps verified credit and personal data', async () => {
  const env = rejectedDraftFixture();
  const restored = await HousingDraftService.locked(env.tx, 25);
  assert.equal(restored.status, 'OPEN'); assert.equal(restored.version, 9);
  assert.deepEqual(restored.data, { activeStep: 0, personalInformation: { firstName: 'fixture' } });
  assert.equal(env.payment.housingTenantId, null); assert.equal(env.payment.amount, 100);
  assert.equal(env.payment.status, 'PAID'); assert.equal(env.payment.providerTransactionId, 'fixture-txn');
  await HousingDraftService.locked(env.tx, 25); assert.equal(env.writes.length, 2);
});

test('pending and approved applications cannot reopen their submitted draft', async () => {
  for (const status of ['PENDING', 'APPROVED', 'ACTIVE', 'INACTIVE']) {
    const env = rejectedDraftFixture(status);
    assert.equal((await HousingDraftService.locked(env.tx, 25)).status, 'SUBMITTED');
    assert.equal(env.writes.length, 0); assert.equal(env.payment.housingTenantId, 7);
  }
});

test('Admin cannot approve an old rejected application while its owner is editing the reopened draft', async () => {
  const db = {
    user: { findUnique: async () => ({ version: 1 }), updateMany: async () => ({ count: 1 }) },
    tenant: { findUnique: async () => ({ id: 7, userId: 25, status: 'REJECTED' }) },
    housingApplicationDraft: { findFirst: async () => ({ id: 3, status: 'OPEN' }) },
    $queryRaw: async () => [],
  } as unknown as DbClient;
  for (const status of ['PENDING', 'APPROVED', 'ACTIVE']) {
    await assert.rejects(TenantsService.updateTenant(7, { status }, db),
      (error: unknown) => error instanceof AppError && error.statusCode === 409 && error.message.includes('ยื่นใบสมัครใหม่'));
  }
});

test('reopening rejects credit owned elsewhere, approved deposits, bill payments and invalid consumed payments', async () => {
  for (const fields of [{ payerUserId: 99 }, { housingTenantId: 99 }, { housingApprovedAt: new Date() }, { billId: 1 }, { status: 'REFUNDED' }]) {
    const env = rejectedDraftFixture('REJECTED', fields);
    await assert.rejects(HousingDraftService.locked(env.tx, 25), (error: unknown) => error instanceof AppError && error.statusCode === 409);
    assert.equal(env.writes.length, 0);
  }
});

const file = { mimetype: 'image/png', buffer: Buffer.from('test-image') };
const application = (): SubmitApplicationInput => ({
  userId: 25, contractAccepted: true,
  personalInformation: { fullName: 'ผู้สมัคร ทดสอบ', studentId: '123456', course: 'วิทยาการคอมพิวเตอร์', yearLevel: '1st Year',
    citizenId: '1234567890123', address: '123 ตำบลทดสอบ จังหวัดทดสอบ', birthDate: '2000-01-15' },
  emergencyContact: { emergencyName: 'ผู้ปกครอง', relationship: 'Parent', emergencyNumber: '0812345678' },
  roomPreference: { preferredRoomType: 'Floor 1', roomNumber: '100' },
  ocrData: { verificationId: 7 }, paymentId: 9, idCardImagePath: 'id-cards/test.png', paymentSlipPath: 'payment-slips/test.png',
  contractData: { ...Object.fromEntries(Object.keys(requiredContractFields).map(key => [key, 'รายละเอียด'])),
    tenantName: 'ชื่อเก่า', tenantCitizenId: 'ผิด', tenantAddress: 'ที่อยู่เก่า', tenantAge: '999', roomNumber: '100' },
});

test('edited personal data is the contract source and email input is not required', () => {
  const input = application(); const contract = validateHousingApplication(input);
  assert.equal(contract.tenantName, input.personalInformation.fullName);
  assert.equal(contract.tenantCitizenId, input.personalInformation.citizenId);
  assert.equal(contract.tenantAddress, input.personalInformation.address);
  assert.ok(Number(contract.tenantAge) >= 26);
});
test('missing or invalid birthdays and malformed identity fields cannot overwrite contract values', () => {
  for (const birthDate of ['2026-02-30', '2999-01-01', '01/01/2543', '', '1900-01-01']) {
    const input = application(); input.personalInformation.birthDate = birthDate;
    assert.throws(() => validateHousingApplication(input), (e: unknown) => e instanceof AppError && e.statusCode === 400);
  }
  for (const fields of [{ citizenId: '123' }, { address: '-' }]) {
    const input = application(); Object.assign(input.personalInformation, fields);
    assert.throws(() => validateHousingApplication(input), AppError);
  }
});
test('legacy applications still require valid contract identity when personal fields are absent', () => {
  const input = application(); delete input.personalInformation.birthDate; delete input.personalInformation.citizenId; delete input.personalInformation.address;
  assert.throws(() => validateHousingApplication(input), AppError);
});
test('identity is verified before a room or slip is provided, retaining unreadable OCR fields as empty', async t => {
  const original = prisma.user.findUnique;
  Reflect.set(prisma.user, 'findUnique', async () => ({ phone: '0812345678' }));
  t.after(() => { Reflect.set(prisma.user, 'findUnique', original); });
  t.mock.method(OcrService, 'verifyIdCard', async (_image: string, options: { userId?: number }) => {
    assert.equal(options.userId, 25);
    return { verificationId: 7, imagePath: 'id-cards/test.png', confidence: { idDetected: true, idChecksumValid: false },
      fullNameTh: 'ผู้สมัคร ทดสอบ', citizenId: '***', address: '***', birthDateTh: '-', age: null } as unknown as Awaited<ReturnType<typeof OcrService.verifyIdCard>>;
  });
  const payment = t.mock.method(HousingPaymentService, 'verifySlip', async () => { throw new Error('must not verify payment during identity step'); });
  const result = await TenantsService.verifyIdentity(file, 25);
  assert.equal(result.ocrData.verificationId, 7); assert.equal(result.ocrData.citizenId, '');
  assert.equal(result.ocrData.address, ''); assert.equal(result.ocrData.birthDateTh, ''); assert.equal(payment.mock.callCount(), 0);
});
test('payment uses the existing owned verification without calling OCR again', async t => {
  const originalUser = prisma.user.findUnique; const originalVerification = prisma.idCardVerification.findUnique;
  Reflect.set(prisma.user, 'findUnique', async () => ({ phone: '0812345678' }));
  Reflect.set(prisma.idCardVerification, 'findUnique', async () => ({ id: 7, userId: 25, idDetected: true, imagePath: 'id-cards/test.png' }));
  t.after(() => { Reflect.set(prisma.user, 'findUnique', originalUser); Reflect.set(prisma.idCardVerification, 'findUnique', originalVerification); });
  const ocr = t.mock.method(OcrService, 'verifyIdCard', async () => { throw new Error('must not repeat OCR'); });
  const payment = t.mock.method(HousingPaymentService, 'verifySlip', async (room: string, user: number, _file: unknown, verification: number) => {
    assert.equal(room, '100'); assert.equal(user, 25); assert.equal(verification, 7);
    return { id: 9, amount: 1000, slipPath: 'payment-slips/test.png' } as unknown as Awaited<ReturnType<typeof HousingPaymentService.verifySlip>>;
  });
  const result = await TenantsService.verifyHousingPayment(file, 25, '100', 7);
  assert.equal(result.paymentVerification.id, 9); assert.equal(ocr.mock.callCount(), 0); assert.equal(payment.mock.callCount(), 1);
  Reflect.set(prisma.idCardVerification, 'findUnique', async () => ({ id: 7, userId: 26, idDetected: true, imagePath: 'id-cards/test.png' }));
  await assert.rejects(TenantsService.verifyHousingPayment(file, 25, '100', 7), (e: unknown) => e instanceof AppError && e.statusCode === 422);
  assert.equal(payment.mock.callCount(), 1);
});
test('identity rejects PDF before invoking an external service', async t => {
  const ocr = t.mock.method(OcrService, 'verifyIdCard', async () => { throw new Error('must reject locally'); });
  await assert.rejects(TenantsService.verifyIdentity({ ...file, mimetype: 'application/pdf' }, 25), AppError);
  assert.equal(ocr.mock.callCount(), 0);
});

test('new applications require explicit contract acceptance on the server', () => {
  const input = application(); delete input.contractAccepted;
  assert.throws(() => validateHousingApplication(input), (e: unknown) => e instanceof AppError && e.message.includes('ยอมรับสัญญา'));
});

test('submission keeps edited identity and the account email, rejecting a mismatched verified citizen ID', async t => {
  const input = application(); input.personalInformation.emailAddress = 'forged@example.test';
  input.contractData!.monthlyRent = '1000'; input.contractData!.depositAmount = '1000';
  t.mock.method(settings, 'getContractTerms', async () => ({ ...input.contractData, tenantName: input.personalInformation.fullName, tenantCitizenId: input.personalInformation.citizenId, tenantAddress: input.personalInformation.address, tenantAge: String(new Date().getFullYear() - 2000) }) as unknown as Awaited<ReturnType<typeof settings.getContractTerms>>);
  const hash = createHash('sha256').update(input.personalInformation.citizenId!).digest('hex');
  let citizenIdHash = hash; let saved: Record<string, unknown> | undefined;
  const room = { id: 1, roomNumber: '100', monthlyRent: 1000, floor: 1, status: 'AVAILABLE', capacity: 4, tenants: [] };
  const db = {
    systemSetting: { findUnique: async () => null },
    user: { findUnique: async () => ({ version: 1, phone: '0812345678', email: 'account@example.test' }), updateMany: async () => ({ count: 1 }) },
    tenant: { findUnique: async () => null, count: async () => 1, create: async ({ data }: { data: Record<string, unknown> }) => { saved = data; return { id: 11, ...data }; } },
    room: { findUnique: async () => room, update: async () => room },
    idCardVerification: { findUnique: async () => ({ id: 7, userId: 25, idDetected: true, imagePath: input.idCardImagePath, fullNameTh: input.personalInformation.fullName,
      idChecksumValid: true, citizenIdHash, birthDateTh: '15 มกราคม 2542' }) },
    payment: { updateMany: async () => ({ count: 1 }) }, $queryRaw: async () => [],
  } as unknown as DbClient;
  const old = prisma.systemSetting.findUnique;
  Reflect.set(prisma.systemSetting, 'findUnique', async () => ({ value: '4' }));
  t.after(() => { Reflect.set(prisma.systemSetting, 'findUnique', old); });
  t.mock.method(fs, 'access', async () => {});
  t.mock.method(HousingPaymentService, 'requireVerifiedPayment', async (_db: unknown, options: { userId: number; roomNumber: string; verificationId: number }) => {
    assert.equal(options.userId, 25); assert.equal(options.roomNumber, '100'); assert.equal(options.verificationId, 7);
    return { id: 9, housingRoomId: 1, housingTenantId: null } as unknown as Awaited<ReturnType<typeof HousingPaymentService.requireVerifiedPayment>>;
  });
  await TenantsService.submitApplication(input, db);
  assert.equal(saved?.email, 'account@example.test'); assert.equal(saved?.birthDate, input.personalInformation.birthDate);
  assert.equal(saved?.address, input.personalInformation.address);
  const contract = JSON.parse(String(saved?.contractData)); assert.equal(contract.tenantBirthDate, input.personalInformation.birthDate);
  assert.equal(contract.contractAccepted, 'true'); assert.ok(contract.contractAcceptedAt);
  citizenIdHash = 'different-card'; saved = undefined;
  await assert.rejects(TenantsService.submitApplication(input, db), (e: unknown) => e instanceof AppError && e.message.includes('เลขบัตรประชาชนไม่ตรง'));
  assert.equal(saved, undefined);
});


test('identity OCR and slip verification do not require an account phone', async t => {
  const original = prisma.user.findUnique;
  Reflect.set(prisma.user, 'findUnique', async () => ({ phone: null }));
  t.after(() => { Reflect.set(prisma.user, 'findUnique', original); });
  const ocr = t.mock.method(OcrService, 'verifyIdCard', async () => ({
    verificationId: 7, imagePath: 'id-cards/test.png',
    confidence: { idDetected: true, idChecksumValid: false },
    fullNameTh: 'ผู้สมัคร ทดสอบ',
  }) as unknown as Awaited<ReturnType<typeof OcrService.verifyIdCard>>);
  const result = await TenantsService.verifyIdentity(file, 25);
  assert.equal(ocr.mock.callCount(), 1);
  assert.equal(result.registeredPhone, '');
  assert.equal(result.ocrData.fullNameTh, 'ผู้สมัคร ทดสอบ');
  assert.equal(result.ocrData.verificationId, 7);
  const originalVerification = prisma.idCardVerification.findUnique;
  Reflect.set(prisma.idCardVerification, 'findUnique', async () => ({ id: 7, userId: 25, idDetected: true, imagePath: 'id-cards/test.png' }));
  t.after(() => { Reflect.set(prisma.idCardVerification, 'findUnique', originalVerification); });
  const payment = t.mock.method(HousingPaymentService, 'verifySlip', async () => ({
    id: 8, slipPath: 'payment-slips/test.png', amount: 300,
  }) as unknown as Awaited<ReturnType<typeof HousingPaymentService.verifySlip>>);
  const verified = await TenantsService.verifyHousingPayment(file, 25, '100', 7);
  assert.equal(verified.registeredPhone, '');
  assert.equal(verified.paymentVerification.status, 'PAID');
  assert.equal(payment.mock.callCount(), 1);
});

test('omitting identity fields or consent cannot bypass the application contract through legacy payloads', () => {
  for (const field of ['birthDate', 'citizenId', 'address'] as const) {
    const input = application(); delete input.personalInformation[field];
    Object.assign(input.contractData!, { tenantCitizenId: '1234567890123', tenantAge: '26', tenantAddress: 'Valid legacy address' });
    assert.throws(() => validateHousingApplication(input), AppError);
  }
  for (const contractAccepted of [undefined, false, 'true', 1]) {
    const input = application(); Object.assign(input, { contractAccepted });
    assert.throws(() => validateHousingApplication(input), AppError);
  }
});
