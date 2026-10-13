import assert from 'node:assert/strict';
import { it, TestContext } from 'node:test';
import express from 'express';
import { Role } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { AuthRepository } from '../../src/modules/auth/auth.repository';
import { AuthService } from '../../src/modules/auth/auth.service';
import authRoutes from '../../src/modules/auth/auth.routes';
import { verifyToken } from '../../src/middlewares/auth-jwt';
import { AppError, errorHandler } from '../../src/middlewares/error-handler';
import { createResponse } from '../../src/shared/api-response';

const start = async (t: TestContext, routes = false) => {
  const app = express();
  app.use(express.json({ strict: false }));
  if (routes) app.use('/auth', authRoutes);
  else {
    app.post('/auth/login', AuthController.login);
    app.get('/auth/me', verifyToken, (_req, res) => res.json(createResponse(200, 'OK')));
  }
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}/auth`;
};
const post = (url: string, body: object | string | number | null) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

it('login rejects malformed bodies and types before calling the service', async t => {
  const service = t.mock.method(AuthService, 'login', async () => { throw Error('Service must not run'); });
  const url = await start(t);
  for (const body of [null, [], 'text', 7, {}, { email: 7, password: 'abc' },
    { email: {}, password: 'abc' }, { email: 'invalid', password: 'abc' },
    { email: 'qa@example.com', password: 123 }, { email: 'qa@example.com', password: [] },
    { email: 'qa@example.com', password: '' }]) {
    const response = await post(`${url}/login`, body);
    assert.equal(response.status, 400);
    const envelope = await response.json();
    assert.equal(envelope.statusCode, 400);
    assert.equal(envelope.success, false);
    assert.equal(envelope.data, null);
  }
  assert.equal(service.mock.callCount(), 0);
});

it('login keeps password unchanged and authenticates using only the HttpOnly cookie', async t => {
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'unit-cookie-contract-secret';
  t.after(() => { if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret; });
  const user = { id: 57, email: 'qa@example.com', username: 'qa', role: Role.STUDENT, lastLogin: '2026-10-06T00:00:00Z', isOnline: true };
  t.mock.method(AuthRepository, 'findSessionUser', async () => ({ id: user.id, role: user.role, authSessionVersion: 1 }));
  const token = jwt.sign({ id: user.id, role: user.role, sessionVersion: 1 }, process.env.JWT_SECRET);
  const service = t.mock.method(AuthService, 'login', async () => ({ user, token, sessionTimeoutMinutes: 30 }));
  const url = await start(t);
  const response = await post(`${url}/login`, { email: user.email, password: ' spaced password ' });
  assert.equal(response.status, 200);
  assert.deepEqual(service.mock.calls[0].arguments, [user.email, ' spaced password ']);
  assert.deepEqual(await response.json(), { statusCode: 200, success: true, message: 'เข้าสู่ระบบสำเร็จ', data: { user } });
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\//i);
  const me = await fetch(`${url}/me`, { headers: { Cookie: cookie.split(';')[0] } });
  assert.equal(me.status, 200);
  assert.equal((await fetch(`${url}/me`)).status, 401);
});

it('invalid credentials return the standard 401 envelope without a cookie', async t => {
  t.mock.method(AuthService, 'login', async () => { throw new AppError('Invalid credentials', 401); });
  const url = await start(t);
  const response = await post(`${url}/login`, { email: 'qa@example.com', password: 'wrong' });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(await response.json(), { statusCode: 401, success: false, message: 'Invalid credentials', data: null });
});

it('all Auth limiters return a 429 envelope and retry headers', async t => {
  const url = await start(t, true);
  for (const [route, max] of [['login', Number(process.env.LOGIN_RATE_LIMIT_MAX || 5)], ['register', Number(process.env.REGISTER_RATE_LIMIT_MAX || 10)], ['forgot-password', 3], ['reset-password', 10]] as const) {
    for (let i = 0; i < max; i++) { const response = await post(`${url}/${route}`, {}); await response.text(); assert.equal(response.status, 400); }
    const response = await post(`${url}/${route}`, {});
    assert.equal(response.status, 429);
    assert.ok(response.headers.get('retry-after'));
    const body = await response.json();
    assert.equal(body.statusCode, response.status);
    assert.equal(body.success, false);
    assert.equal(body.data, null);
    assert.equal(typeof body.message, 'string');
  }
});

it('register rejects malformed input before hashing or database writes', async t => {
  const service = t.mock.method(AuthService, 'register', async () => { throw Error('Service must not run'); });
  const app = express(); app.use(express.json({ strict: false })); app.post('/register', AuthController.register); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  t.after(() => new Promise<void>((r, reject) => server.close(e => e ? reject(e) : r())));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const valid = { email: 'qa@example.test', password: 'QaTest!2026', phone: '0812345678', username: 'qa' };
  for (const body of [null, [], 7, {}, ...[{ email: 7 }, { email: 'invalid' }, { password: [] }, { password: 'x'.repeat(73) }, { username: {} }, { username: ' ' }, { phone: 812345678 }].map(change => ({ ...valid, ...change }))]) {
    const response = await post(`http://127.0.0.1:${address.port}/register`, body);
    assert.equal(response.status, 400); assert.equal((await response.json()).data, null);
  }
  assert.equal(service.mock.callCount(), 0);
});
