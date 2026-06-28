import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AuthenticatedRequest, requireRole, verifyToken } from '../../src/middlewares/auth-jwt';
import { AppError } from '../../src/middlewares/error-handler';

const jwtSecret = 'unit-test-secret';

const createNextSpy = () => {
  const calls: unknown[] = [];
  const next: NextFunction = (error?: unknown) => {
    calls.push(error);
  };

  return { next, calls };
};

describe('auth-jwt middleware', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = jwtSecret;
  });

  it('rejects requests without bearer token', () => {
    const req = { headers: {} } as AuthenticatedRequest;
    const { next, calls } = createNextSpy();

    verifyToken(req, {} as Response, next);

    assert.equal(calls.length, 1);
    assert.ok(calls[0] instanceof AppError);
    assert.equal((calls[0] as AppError).statusCode, 401);
  });

  it('sets req.user when bearer token is valid', () => {
    const token = jwt.sign({ id: 7, role: 'ADMIN' }, jwtSecret);
    const req = {
      headers: {
        authorization: `Bearer ${token}`,
      },
    } as AuthenticatedRequest;
    const { next, calls } = createNextSpy();

    verifyToken(req, {} as Response, next);

    assert.equal(req.user?.id, 7);
    assert.equal(req.user?.role, 'ADMIN');
    assert.equal(calls.length, 1);
    assert.equal(calls[0], undefined);
  });

  it('rejects users without required role', () => {
    const req = {
      user: {
        id: 8,
        role: 'STUDENT',
      },
    } as AuthenticatedRequest;
    const { next, calls } = createNextSpy();

    requireRole(['ADMIN'])(req, {} as Response, next);

    assert.equal(calls.length, 1);
    assert.ok(calls[0] instanceof AppError);
    assert.equal((calls[0] as AppError).statusCode, 403);
  });

  it('allows users with required role', () => {
    const req = {
      user: {
        id: 9,
        role: 'ADMIN',
      },
    } as AuthenticatedRequest;
    const { next, calls } = createNextSpy();

    requireRole(['ADMIN'])(req, {} as Response, next);

    assert.equal(calls.length, 1);
    assert.equal(calls[0], undefined);
  });
});
