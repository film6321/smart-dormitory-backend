import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Server } from 'node:http';
import express from 'express';
import { AppError, errorHandler } from '../../src/middlewares/error-handler';

describe('error response integration', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const app = express();

    app.get('/app-error', () => {
      throw new AppError('Known failure', 418);
    });

    app.get('/unknown-error', () => {
      throw new Error('Unexpected failure');
    });

    app.use(errorHandler);

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

  it('serializes AppError with statusCode and message', async () => {
    const response = await fetch(`${baseUrl}/app-error`);
    const body = await response.json();

    assert.equal(response.status, 418);
    assert.deepEqual(body, {
      statusCode: 418,
      message: 'Known failure',
    });
  });

  it('hides unknown error details behind a standard 500 response', async () => {
    const response = await fetch(`${baseUrl}/unknown-error`);
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(body, {
      statusCode: 500,
      message: 'Internal Server Error',
    });
  });
});
