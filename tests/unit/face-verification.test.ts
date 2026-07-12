import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FaceVerificationService } from '../../src/modules/face-verification/face-verification.service';

const originalFetch = global.fetch;

describe('FaceVerificationService (unit)', () => {
  const mockUrl = 'http://localhost:8000';
  const mockKey = 'test-face-key';

  it('successfully registers a face', async () => {
    process.env.FACE_API_URL = mockUrl;
    process.env.FACE_API_KEY = mockKey;

    let requestUrl = '';
    let headers: Record<string, string> = {};
    let requestMethod = '';

    global.fetch = (async (url: string, init?: any) => {
      requestUrl = url;
      requestMethod = init?.method || 'GET';
      headers = init?.headers || {};

      return {
        ok: true,
        status: 201,
        json: async () => ({
          success: true,
          message: 'Face template registered successfully for user 99.',
          data: {
            id: 12,
            user_id: 99,
            model_name: 'buffalo_l',
            embedding_version: 'v1',
            created_at: '2026-07-06T18:00:00Z',
            updated_at: '2026-07-06T18:00:00Z',
          },
        }),
      } as Response;
    }) as any;

    try {
      const buffer = Buffer.from('fake-image-bytes');
      const result = await FaceVerificationService.registerFace(
        99,
        buffer,
        'image/jpeg',
        'avatar.jpg'
      );

      assert.equal(requestUrl, 'http://localhost:8000/api/v1/faces/register');
      assert.equal(requestMethod, 'POST');
      assert.equal(headers['X-API-Key'], 'test-face-key');
      assert.equal(result.id, 12);
      assert.equal(result.user_id, 99);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('successfully verifies a face', async () => {
    process.env.FACE_API_URL = mockUrl;
    process.env.FACE_API_KEY = mockKey;

    let requestUrl = '';
    let headers: Record<string, string> = {};

    global.fetch = (async (url: string, init?: any) => {
      requestUrl = url;
      headers = init?.headers || {};

      return {
        ok: true,
        status: 200,
        json: async () => ({
          matched: true,
          user_id: 99,
          similarity: 0.8521,
          processing_time_ms: 125.4,
        }),
      } as Response;
    }) as any;

    try {
      const buffer = Buffer.from('fake-image-bytes-verify');
      const result = await FaceVerificationService.verifyFace(
        buffer,
        'image/png',
        'test.png',
        0.65
      );

      assert.equal(requestUrl, 'http://localhost:8000/api/v1/faces/verify');
      assert.equal(headers['X-API-Key'], 'test-face-key');
      assert.equal(result.matched, true);
      assert.equal(result.user_id, 99);
      assert.equal(result.similarity, 0.8521);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('manages face templates via CRUD endpoints', async () => {
    process.env.FACE_API_URL = mockUrl;
    process.env.FACE_API_KEY = mockKey;

    global.fetch = (async (url: string, init?: any) => {
      const parts = url.split('/');
      const templateId = parts[parts.length - 1];
      const method = init?.method || 'GET';

      if (method === 'GET' && templateId === '12') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 12,
            user_id: 99,
            model_name: 'buffalo_l',
            embedding_version: 'v1',
            created_at: '2026-07-06T18:00:00Z',
            updated_at: '2026-07-06T18:00:00Z',
          }),
        } as Response;
      }

      if (method === 'PUT' && templateId === '12') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            message: 'Face template updated successfully.',
            data: {
              id: 12,
              user_id: 99,
              model_name: 'buffalo_l',
              embedding_version: 'v1',
              created_at: '2026-07-06T18:00:00Z',
              updated_at: '2026-07-06T18:10:00Z',
            },
          }),
        } as Response;
      }

      if (method === 'DELETE' && templateId === '12') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            message: 'Face template deleted successfully.',
          }),
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ detail: 'Not Found' }),
      } as Response;
    }) as any;

    try {
      const template = await FaceVerificationService.getFaceTemplate(12);
      assert.equal(template.id, 12);
      assert.equal(template.user_id, 99);

      const buffer = Buffer.from('fake-image-bytes-new');
      const updated = await FaceVerificationService.updateFaceTemplate(
        12,
        buffer,
        'image/jpeg',
        'updated.jpg'
      );
      assert.equal(updated.id, 12);

      const deleteRes = await FaceVerificationService.deleteFaceTemplate(12);
      assert.equal(deleteRes.success, true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('throws an error if configuration are missing', async () => {
    const prevUrl = process.env.FACE_API_URL;
    delete process.env.FACE_API_URL;

    try {
      const buffer = Buffer.from('fake-image-bytes');
      await assert.rejects(
        FaceVerificationService.registerFace(99, buffer, 'image/jpeg', 'avatar.jpg'),
        /FACE_API_URL is not configured/
      );
    } finally {
      process.env.FACE_API_URL = prevUrl;
    }
  });
});
