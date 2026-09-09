import { NextFunction, Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { AuthenticatedRequest, requireRole, verifyToken } from '../../middlewares/auth-jwt';
import { AppError } from '../../middlewares/error-handler';
import { createRateLimitStore } from '../../shared/rate-limit-store';
import { FaceVerificationController } from './face-verification.controller';

const router = Router();

// Token check middleware specifically for FaceGate Edge or fallback to user JWTs
const verifyFaceGateToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];
  const expectedToken = process.env.FACE_API_KEY || 'face-recognition-secret-key-change-me-in-production';

  if (token && token === expectedToken) {
    (req as any).user = { id: 0, role: 'ADMIN' };
    return next();
  }

  // Fallback to standard admin check
  verifyToken(req as any, res, next);
};

const faceLimiter = rateLimit({
  store: createRateLimitStore('rl:face:lock:'),
  windowMs: 60 * 1000,
  max: 100, // 100 requests per minute to support frequent camera captures
  message: { statusCode: 429, message: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const allowedImageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedImageMimeTypes.has(file.mimetype)) {
      callback(new AppError('Only JPG, PNG, and WebP image files are allowed', 400));
      return;
    }

    callback(null, true);
  },
});

const uploadFaceImage = (req: Request, res: Response, next: NextFunction) => {
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'image', maxCount: 1 },
  ])(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      next(new AppError(error.code === 'LIMIT_FILE_SIZE' ? 'Image file must be 5MB or smaller' : error.message, 400));
      return;
    }

    next(error);
  });
};

const authorizeFaceRegistration = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const requestedUserId = Number(req.body.userId || req.body.user_id);

  if (req.user?.role === 'ADMIN' || req.user?.id === requestedUserId) {
    return next();
  }

  return next(new AppError('You can only register your own face template', 403));
};

// ── Web Dashboard/Legacy API Endpoints ──
router.post('/register', verifyToken, uploadFaceImage, authorizeFaceRegistration, FaceVerificationController.register);
router.post('/verify', faceLimiter, uploadFaceImage, FaceVerificationController.verify);
router.post('/verify-image', faceLimiter, uploadFaceImage, FaceVerificationController.verify);

// ── C# FaceGate.Edge Integration Endpoints ──
router.get('/embeddings', verifyFaceGateToken, FaceVerificationController.embeddings);
router.get('/enrollment/pending', verifyFaceGateToken, FaceVerificationController.pending);
router.get('/enrollment/photo/:id', verifyFaceGateToken, FaceVerificationController.photo);
router.post('/enrollment/:studentId/embeddings', verifyFaceGateToken, FaceVerificationController.storeEmbeddings);
router.post('/attendance/scan', verifyFaceGateToken, FaceVerificationController.scan);
router.post('/devices/heartbeat', verifyFaceGateToken, FaceVerificationController.heartbeat);
router.post('/door-command', verifyToken, requireRole(['ADMIN']), FaceVerificationController.doorCommand);
router.post('/devices/live-frame', verifyFaceGateToken, FaceVerificationController.liveFrame);
// Generic detections endpoint (from custom detectors like YOLO)
router.post('/detections', verifyFaceGateToken, FaceVerificationController.detections);
router.get('/live-stream', FaceVerificationController.liveStream);
router.get('/devices', verifyToken, requireRole(['ADMIN']), FaceVerificationController.devices);
router.get('/scan-history', verifyToken, requireRole(['ADMIN']), FaceVerificationController.scanHistory);
router.get('/events', verifyToken, requireRole(['ADMIN']), FaceVerificationController.events);

// ── Template Management Endpoints ──
router.get('/:templateId', verifyToken, requireRole(['ADMIN']), FaceVerificationController.getTemplate);
router.put('/:templateId', verifyToken, requireRole(['ADMIN']), uploadFaceImage, FaceVerificationController.updateTemplate);
router.delete('/:templateId', verifyToken, requireRole(['ADMIN']), FaceVerificationController.deleteTemplate);

export default router;
