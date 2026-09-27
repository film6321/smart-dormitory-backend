import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { prisma } from '../../src/database/db';
import { TenantsRepository } from '../../src/modules/tenants/tenants.repository';
import { BillingRepository } from '../../src/modules/billing/billing.repository';
import { RoomsRepository } from '../../src/modules/rooms/rooms.repository';
import { UsersRepository } from '../../src/modules/users/users.repository';
import { OcrRepository } from '../../src/modules/ocr/ocr.repository';
import { AppError, errorHandler } from '../../src/middlewares/error-handler';
if (new URL(process.env.DATABASE_URL!).pathname !== '/delete_guard_test') throw new Error('Requires isolated delete_guard_test database');
after(() => prisma.$disconnect());
const status = (code: number) => (e: unknown) => e instanceof AppError && e.statusCode === code;
test('visitor registration columns persist after migrations', async () => {
  const visitor = await prisma.visitor.create({ data: { guestName: 'Test', phone: 'test', pdpaConsent: true,
    pdpaConsentAt: new Date(), expiresAt: new Date(Date.now() + 86400000), qrCodeData: 'test-pass' } });
  const stored = await prisma.visitor.findUniqueOrThrow({ where: { id: visitor.id } });
  assert.equal(stored.phone, 'test'); assert.equal(stored.pdpaConsent, true);
});
test('payment evidence blocks tenant, room, user and OCR deletes; HTTP returns 409', async () => {
  const user = await prisma.user.create({ data: { email: 'delete@example.test', password: 'test' } });
  const room = await prisma.room.create({ data: { roomNumber: '101', monthlyRent: 100 } });
  const tenant = await prisma.tenant.create({ data: { userId: user.id, roomId: room.id, status: 'REJECTED' } });
  const verification = await prisma.idCardVerification.create({ data: { isThaiIdCard: true, imagePath: 'evidence.png' } });
  const payment = await prisma.payment.create({ data: { payerUserId: user.id, housingRoomId: room.id,
    housingTenantId: tenant.id, housingVerificationId: verification.id, amount: 100, status: 'PAID', idempotencyKey: 'delete-test' } });
  await assert.rejects(TenantsRepository.deleteTenant(tenant.id), status(409));
  await assert.rejects(RoomsRepository.deleteRoom(room.id), status(409));
  await assert.rejects(UsersRepository.deleteUser(user.id), status(409));
  await assert.rejects(OcrRepository.deleteIdCardVerification(verification.id), status(409));
  assert.ok(await prisma.payment.findUnique({ where: { id: payment.id } }));
  assert.ok(await prisma.tenant.findUnique({ where: { id: tenant.id } }));
  const app = express();
  app.delete('/:id', async (req, res, next) => { try { await TenantsRepository.deleteTenant(Number(req.params.id)); res.sendStatus(204); } catch (e) { next(e); } });
  app.use(errorHandler); const server = app.listen(0); await once(server, 'listening');
  try { const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/${tenant.id}`, { method: 'DELETE' });
    assert.equal(response.status, 409); assert.equal((await response.json()).statusCode, 409);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
  const bill = await prisma.bill.create({ data: { tenantId: tenant.id, amount: 100, dueDate: new Date(), status: 'PAID' } });
  await assert.rejects(BillingRepository.deleteBill(bill.id), status(409));
  const unpaid = await prisma.bill.create({ data: { tenantId: tenant.id, amount: 100, dueDate: new Date() } });
  const batch = await prisma.paymentBatch.create({ data: { payerUserId: user.id, amount: 100, idempotencyKey: 'batch-delete-test',
    items: { create: { billId: unpaid.id, amount: 100 } } } });
  await assert.rejects(BillingRepository.deleteBill(unpaid.id), status(409));
  assert.equal(await prisma.paymentBatchItem.count({ where: { batchId: batch.id } }), 1);
});
test('unreferenced records can be deleted and missing records return 404', async () => {
  const room = await prisma.room.create({ data: { roomNumber: '201', monthlyRent: 50, status: 'INACTIVE' } });
  const tenant = await prisma.tenant.create({ data: { roomId: room.id } });
  await TenantsRepository.deleteTenant(tenant.id);
  assert.equal((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).status, 'INACTIVE');
  await assert.rejects(TenantsRepository.deleteTenant(tenant.id), status(404));
  await RoomsRepository.deleteRoom(room.id);
  await assert.rejects(RoomsRepository.deleteRoom(room.id), status(404));
  const user = await prisma.user.create({ data: { email: 'empty@example.test', password: 'test' } });
  await UsersRepository.deleteUser(user.id);
  await assert.rejects(UsersRepository.deleteUser(user.id), status(404));
});
