import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createResponse } from '../../src/shared/api-response';

describe('createResponse', () => {
  it('returns statusCode and message with success and null data when data is omitted', () => {
    const response = createResponse(200, 'OK');

    assert.deepEqual(response, {
      statusCode: 200,
      success: true,
      message: 'OK',
      data: null,
    });
  });

  it('returns statusCode, message, and typed data when data is provided', () => {
    const response = createResponse(201, 'Created', { id: 1, name: 'Room A101' });

    assert.equal(response.statusCode, 201);
    assert.equal(response.success, true);
    assert.equal(response.message, 'Created');
    assert.deepEqual(response.data, { id: 1, name: 'Room A101' });
  });
  it('keeps null data in serialized errors and preserves falsy data', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(createResponse(400, 'Invalid'))), {
      statusCode: 400, success: false, message: 'Invalid', data: null,
    });
    for (const value of [false, 0, '']) assert.equal(createResponse(200, 'OK', value).data, value);
    assert.equal(createResponse(302, 'Redirect').success, false);
  });
});
