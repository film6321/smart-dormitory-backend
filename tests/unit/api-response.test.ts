import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createResponse } from '../../src/shared/api-response';

describe('createResponse', () => {
  it('returns statusCode and message without data when data is omitted', () => {
    const response = createResponse(200, 'OK');

    assert.deepEqual(response, {
      statusCode: 200,
      message: 'OK',
      data: undefined,
    });
  });

  it('returns statusCode, message, and typed data when data is provided', () => {
    const response = createResponse(201, 'Created', { id: 1, name: 'Room A101' });

    assert.equal(response.statusCode, 201);
    assert.equal(response.message, 'Created');
    assert.deepEqual(response.data, { id: 1, name: 'Room A101' });
  });
});
