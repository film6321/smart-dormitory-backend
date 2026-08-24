import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Server } from 'node:http';
import app from '../../src/app';

describe('door command route', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address();
        assert.ok(address && typeof address === 'object');
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  it('accepts unlock and lock door commands for the admin access control panel', async () => {
    const unlockResponse = await fetch(`${baseUrl}/api/face-verification/door-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: 'CAMERA_01', action: 'unlock', timestamp: new Date().toISOString() }),
    });

    assert.equal(unlockResponse.status, 200);
    const unlockBody = await unlockResponse.json();
    assert.equal(unlockBody.data.action, 'unlock');
    assert.equal(unlockBody.data.device_code, 'CAMERA_01');

    const lockResponse = await fetch(`${baseUrl}/api/face-verification/door-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: 'CAMERA_01', action: 'lock', timestamp: new Date().toISOString() }),
    });

    assert.equal(lockResponse.status, 200);
    const lockBody = await lockResponse.json();
    assert.equal(lockBody.data.action, 'lock');
    assert.equal(lockBody.data.device_code, 'CAMERA_01');
  });
});
