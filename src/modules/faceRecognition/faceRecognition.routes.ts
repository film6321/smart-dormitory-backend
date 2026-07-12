import { Router } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const router = Router();

const target = process.env.FACE_RECOGNITION_URL || 'http://face_recognition:8000';

// Proxy POST /register and /verify and other relevant endpoints to the face recognition service
router.use(
  '/',
  // Cast options to any to avoid strict typing mismatch with the middleware's callback hooks
  createProxyMiddleware(({
    target,
    changeOrigin: true,
    pathRewrite: {
      '^/api/face-recognition': '',
    },
    onProxyReq(proxyReq: any) {
      const apiKey = process.env.FACE_RECOGNITION_API_KEY;
      if (apiKey) proxyReq.setHeader('X-API-Key', apiKey);
    },
    logLevel: 'warn',
  } as any)),
);

export default router;
