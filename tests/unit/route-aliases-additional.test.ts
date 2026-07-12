import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import billingRoutes from '../../src/modules/billing/billing.routes';
import ocrRoutes from '../../src/modules/ocr/ocr.routes';

type ExpressRouter = {
  stack: Array<{
    route?: {
      path: string;
      methods: Record<string, boolean>;
    };
  }>;
};

const listRoutePaths = (router: ExpressRouter, method: string) =>
  router.stack
    .map((layer) => layer.route)
    .filter((route): route is { path: string; methods: Record<string, boolean> } => Boolean(route))
    .filter((route) => route.methods[method.toLowerCase()])
    .map((route) => route.path);

const hasRoute = (router: ExpressRouter, method: string, path: string): boolean =>
  listRoutePaths(router, method).includes(path);

describe('route alias coverage (additional)', () => {
  it('supports OCR alias POST /verify and GET /jobs/:jobId paths', () => {
    assert.deepStrictEqual(listRoutePaths(ocrRoutes as ExpressRouter, 'post').sort(), [
      '/verify-id-card',
      '/verify-id-card/jobs',
      '/verify',
    ].sort());
    assert.ok(hasRoute(ocrRoutes as ExpressRouter, 'get', '/jobs/:jobId'));
  });

  it('supports billing alias POST /:id/upload and POST /:id/upload-slip paths', () => {
    const postPaths = listRoutePaths(billingRoutes as ExpressRouter, 'post');
    assert.ok(postPaths.includes('/:id/upload-slip'));
    assert.ok(postPaths.includes('/:id/upload'));
    assert.strictEqual(postPaths.filter((path) => path === '/:id/upload').length, 1);
  });
});
