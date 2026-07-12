import { NextFunction, Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { requireRole, verifyToken } from '../../middlewares/auth-jwt';
import { AppError } from '../../middlewares/error-handler';
import { createRateLimitStore } from '../../shared/rate-limit-store';
import { OcrController } from './ocr.controller';

const router = Router();

const verifyIdCardLimiter = rateLimit({
  store: createRateLimitStore('rl:ocr:verify-id-card:'),
  windowMs: 60 * 1000,
  max: 10,
  message: { statusCode: 429, message: 'Too many OCR verification requests, please try again later' },
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

const uploadIdCardImage = (req: Request, res: Response, next: NextFunction) => {
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'idCard', maxCount: 1 },
    { name: 'document', maxCount: 1 },
  ])(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      next(new AppError(error.code === 'LIMIT_FILE_SIZE' ? 'Image file must be 5MB or smaller' : error.message, 400));
      return;
    }

    next(error);
  });
};

router.post('/verify-id-card', verifyIdCardLimiter, uploadIdCardImage, OcrController.verifyIdCard);
router.post('/verify', verifyIdCardLimiter, uploadIdCardImage, OcrController.verifyIdCard); // Alias route for SYSTEM-BLOCK-DIAGRAM.md
router.post('/verify-id-card/jobs', verifyIdCardLimiter, uploadIdCardImage, OcrController.createIdCardVerificationJob);
router.get('/jobs/:jobId', verifyIdCardLimiter, OcrController.getIdCardVerificationJob); // Alias route for SYSTEM-BLOCK-DIAGRAM.md
router.get('/verify-id-card/jobs/:jobId', verifyIdCardLimiter, OcrController.getIdCardVerificationJob);
router.get(
  '/id-card-verifications',
  verifyToken,
  requireRole(['ADMIN']),
  OcrController.listIdCardVerifications,
);
router.get(
  '/id-card-verifications/:id',
  verifyToken,
  requireRole(['ADMIN']),
  OcrController.getIdCardVerification,
);
router.get(
  '/id-card-verifications/:id/image',
  verifyToken,
  requireRole(['ADMIN']),
  OcrController.getIdCardVerificationImage,
);
router.delete(
  '/id-card-verifications/:id',
  verifyToken,
  requireRole(['ADMIN']),
  OcrController.deleteIdCardVerification,
);

export default router;
