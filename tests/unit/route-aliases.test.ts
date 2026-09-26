import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import billingRoutes from '../../src/modules/billing/billing.routes';
import ocrRoutes from '../../src/modules/ocr/ocr.routes';
import visitorRoutes from '../../src/modules/visitor/visitor.routes';

type ExpressRouter = {
  stack: Array<{
    route?: {
      path: string;
      methods: Record<string, boolean>;
    };
  }>;
};

const hasRoute = (router: ExpressRouter, method: string, path: string): boolean =>
  router.stack.some((layer) => {
    const route = layer.route;
    return !!route && route.path === path && route.methods[method.toLowerCase()];
  });

describe('route alias coverage', () => {
  it('registers OCR verify aliases and job endpoints', () => {
    assert.ok(hasRoute(ocrRoutes as ExpressRouter, 'POST', '/identity-card'));
    assert.ok(hasRoute(ocrRoutes as ExpressRouter, 'POST', '/id-card'));
    assert.ok(hasRoute(ocrRoutes as ExpressRouter, 'POST', '/idcard'));
    assert.ok(hasRoute(ocrRoutes as ExpressRouter, 'POST', '/verify-id-card'));
    assert.ok(hasRoute(ocrRoutes as ExpressRouter, 'POST', '/verify'));
    assert.ok(hasRoute(ocrRoutes as ExpressRouter, 'POST', '/verify-id-card/jobs'));
    assert.ok(hasRoute(ocrRoutes as ExpressRouter, 'POST', '/jobs'));
    assert.ok(hasRoute(ocrRoutes as ExpressRouter, 'GET', '/jobs/:jobId'));
    assert.ok(hasRoute(ocrRoutes as ExpressRouter, 'GET', '/verify-id-card/jobs/:jobId'));
  });

  it('registers billing upload alias routes', () => {
    assert.ok(hasRoute(billingRoutes as ExpressRouter, 'POST', '/:id/upload-slip'));
    assert.ok(hasRoute(billingRoutes as ExpressRouter, 'POST', '/:id/upload'));
    assert.ok(hasRoute(billingRoutes as ExpressRouter, 'PATCH', '/:id/status'));
  });

  it('registers visitor alias routes', () => {
    assert.ok(hasRoute(visitorRoutes as ExpressRouter, 'POST', '/scan-id-card'));
    assert.ok(hasRoute(visitorRoutes as ExpressRouter, 'POST', '/verify-id-card'));
    assert.ok(hasRoute(visitorRoutes as ExpressRouter, 'POST', '/verify'));
    assert.ok(hasRoute(visitorRoutes as ExpressRouter, 'POST', '/register'));
    assert.ok(hasRoute(visitorRoutes as ExpressRouter, 'GET', '/:id/pass'));
    assert.ok(hasRoute(visitorRoutes as ExpressRouter, 'GET', '/:id'));
    assert.ok(hasRoute(visitorRoutes as ExpressRouter, 'POST', '/:id/cancel'));
  });
});
