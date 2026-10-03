import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { FaceVerificationController } from '../../src/modules/face-verification/face-verification.controller';
import { FaceVerificationService } from '../../src/modules/face-verification/face-verification.service';

describe('simulated door command controller', () => {
  it('records an admin manual-open request and returns the simulated auto-close time', async () => {
    const original = FaceVerificationService.commandSimulatedDoor;
    let serviceArgs: unknown[] = [];
    FaceVerificationService.commandSimulatedDoor = (async (...args: unknown[]) => {
      serviceArgs = args;
      return { status: 'OPEN', simulated: true, auto_close_at: '2026-09-29T00:00:05.000Z' };
    }) as typeof FaceVerificationService.commandSimulatedDoor;

    let statusCode = 0;
    let responseBody: unknown;
    let forwardedError: unknown;
    const response = {
      status(code: number) { statusCode = code; return this; },
      json(body: unknown) { responseBody = body; return this; },
    } as unknown as Response;
    const request = {
      body: { device_code: 'MAIN_GATE_01', action: 'unlock' },
      user: { id: 42, role: 'ADMIN' },
    } as unknown as Request;
    const next = ((error?: unknown) => { forwardedError = error; }) as NextFunction;

    try {
      await FaceVerificationController.doorCommand(request, response, next);
    } finally {
      FaceVerificationService.commandSimulatedDoor = original;
    }

    assert.equal(statusCode, 200);
    assert.equal(forwardedError, undefined);
    assert.deepEqual(serviceArgs, [42, 'MAIN_GATE_01', 'unlock']);
    assert.equal((responseBody as { data?: { simulated?: boolean } }).data?.simulated, true);
  });

  it('rejects unsupported actions before invoking the simulation', async () => {
    let statusCode = 0;
    const response = {
      status(code: number) { statusCode = code; return this; },
      json() { return this; },
    } as unknown as Response;
    const request = { body: { device_code: 'MAIN_GATE_01', action: 'open' } } as Request;
    const next = (() => undefined) as NextFunction;

    await FaceVerificationController.doorCommand(request, response, next);
    assert.equal(statusCode, 400);
  });
});
