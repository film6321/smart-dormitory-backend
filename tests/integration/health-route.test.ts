import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Server } from 'node:http';
import app from '../../src/app';

describe('health route aliases', () => {
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

  it('serves the health endpoint under the /api prefix used by the dashboard', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    assert.ok([200, 503].includes(response.status));
    assert.equal(body.statusCode, response.status);
    assert.ok(body.data?.status === 'healthy' || body.data?.status === 'unhealthy');
  });
});
