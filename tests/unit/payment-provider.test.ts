import test from 'node:test';
import assert from 'node:assert/strict';
import { PaymentProviderClient } from '../../src/modules/billing/payment.provider';
import { AppError } from '../../src/middlewares/error-handler';

const slip = { buffer: Buffer.from('test-image'), mimetype: 'image/png', originalname: 'slip.png' };
const validPayload = () => ({ success: true, matchedAccount: { bankNumber: 'test-account' }, data: {
  isDuplicate: false, rawSlip: { transRef: 'transaction-test', amount: { amount: 100 } },
} });

test('payment provider validates HTTP status and normalized slip metadata', async (t) => {
  const originalUrl = process.env.PAYMENT_API_URL;
  process.env.PAYMENT_API_URL = 'http://payment.test';
  t.after(() => { if (originalUrl === undefined) delete process.env.PAYMENT_API_URL; else process.env.PAYMENT_API_URL = originalUrl; });
  let payload: unknown = validPayload();
  let status = 200;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.ok(init.body instanceof FormData);
    assert.ok(init.body.get('image') instanceof Blob);
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  });
  const valid = await PaymentProviderClient.verifySlip(slip);
  assert.equal(valid.success, true);
  assert.equal(valid.amount, 100);
  assert.equal(valid.transactionId, 'transaction-test');
  assert.equal(valid.recipientMatched, true);
  for (const account of [false, '', {}, []]) {
    payload = { ...validPayload(), matchedAccount: account };
    assert.equal((await PaymentProviderClient.verifySlip(slip)).recipientMatched, false);
  }
  payload = { success: true, matchedAccount: { bankNumber: 'test' }, data: {} };
  const incomplete = await PaymentProviderClient.verifySlip(slip);
  assert.equal(incomplete.success, false);
  assert.equal(incomplete.amount, null);
  payload = validPayload();
  status = 400;
  assert.equal((await PaymentProviderClient.verifySlip(slip)).success, false);
  status = 503;
  await assert.rejects(PaymentProviderClient.verifySlip(slip), (err: unknown) => err instanceof AppError && err.statusCode === 503);
});


test('housing QR combines database rent and security deposit and rejects unavailable rooms or invalid provider images', async (t) => {
  const { prisma } = await import('../../src/database/db');
  const { HousingPaymentService } = await import('../../src/modules/tenants/housing-payment.service');
  let room: { roomNumber: string; status: string; capacity: number; monthlyRent: number; _count: { tenants: number } } | null = {
    roomNumber: '101', status: 'AVAILABLE', capacity: 1, monthlyRent: 100, _count: { tenants: 0 },
  };
  const originalFind = prisma.room.findUnique;
  const delegate = { ...prisma.room };
  const findRoom = t.mock.method(delegate, 'findUnique', async () => room);
  prisma.room.findUnique = delegate.findUnique;
  t.after(() => { prisma.room.findUnique = originalFind; });
  const settings = await import('../../src/modules/settings/settings.service');
  t.mock.method(settings, 'getSettingValue', async () => '4');
  let configured = true;
  t.mock.method(settings, 'getContractTerms', async (candidateRoom?: { monthlyRent: unknown }) => ({
    landlordName: configured ? 'QA landlord' : '', depositAmount: String(candidateRoom?.monthlyRent ?? ''), keycardDeposit: '0',
  }));
  let image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const amounts: number[] = [];
  t.mock.method(PaymentProviderClient, 'generateQr', async (amount: number) => { amounts.push(amount); return image; });
  configured = false;
  await assert.rejects(HousingPaymentService.generateQr('101'), (e: unknown) => e instanceof AppError && e.statusCode === 409);
  assert.deepEqual(amounts, []);
  configured = true;
  const first = await HousingPaymentService.generateQr('101');
  assert.equal(first.amount, 200);
  assert.deepEqual(findRoom.mock.calls[0].arguments[0]?.include?._count, {
    select: { tenants: { where: { isActive: true, status: { in: ['PENDING', 'APPROVED', 'ACTIVE'] } } } },
  });
  assert.equal(first.qrImage, `data:image/png;base64,${image.toString('base64')}`);
  room = { ...room, roomNumber: '201', monthlyRent: 50 };
  assert.equal((await HousingPaymentService.generateQr('201')).amount, 100);
  assert.deepEqual(amounts, [200, 100]);
  room.status = 'INACTIVE';
  await assert.rejects(HousingPaymentService.generateQr('201'), (e: unknown) => e instanceof AppError && e.statusCode === 409);
  room.status = 'AVAILABLE'; room._count.tenants = 1;
  await assert.rejects(HousingPaymentService.generateQr('201'));
  room._count.tenants = 0; room.monthlyRent = 0;
  await assert.rejects(HousingPaymentService.generateQr('201'));
  assert.deepEqual(amounts, [200, 100]);
  room.monthlyRent = 50; image = Buffer.from('<html>provider error</html>');
  await assert.rejects(HousingPaymentService.generateQr('201'), (e: unknown) => e instanceof AppError && e.statusCode === 503);
  room = null;
  await assert.rejects(HousingPaymentService.generateQr('missing'));
});
