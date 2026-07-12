import { NextFunction, Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { requireRole, verifyToken } from '../../middlewares/auth-jwt';
import { AppError } from '../../middlewares/error-handler';
import { createRateLimitStore } from '../../shared/rate-limit-store';
import { FaceVerificationController } from './face-verification.controller';

const router = Router();

const faceLimiter = rateLimit({
  store: createRateLimitStore('rl:face:lock:'),
  windowMs: 60 * 1000,
  max: 20, // 20 requests per minute
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

// Endpoints
router.post('/register', verifyToken, requireRole(['ADMIN']), uploadFaceImage, FaceVerificationController.register);
router.post('/verify', faceLimiter, uploadFaceImage, FaceVerificationController.verify);
router.get('/:templateId', verifyToken, requireRole(['ADMIN']), FaceVerificationController.getTemplate);
router.put('/:templateId', verifyToken, requireRole(['ADMIN']), uploadFaceImage, FaceVerificationController.updateTemplate);
router.delete('/:templateId', verifyToken, requireRole(['ADMIN']), FaceVerificationController.deleteTemplate);

export default router;
