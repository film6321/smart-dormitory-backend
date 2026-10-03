import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { AppError } from '../../middlewares/error-handler';
import { verifyToken, requireRole, optionalVerifyToken } from '../../middlewares/auth-jwt';
import { validateDto } from '../../middlewares/dto-validation';
import { VisitorController } from './visitor.controller';
import {
  registerVisitorSchema,
  cancelVisitorSchema,
  updateVisitorStatusSchema,
} from './visitor.dto';

const router = Router();

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

router.post('/scan-id-card', optionalVerifyToken, uploadIdCardImage, VisitorController.scanVisitorIdCard);
router.post('/verify-id-card', optionalVerifyToken, uploadIdCardImage, VisitorController.scanVisitorIdCard);
router.post('/verify', optionalVerifyToken, uploadIdCardImage, VisitorController.scanVisitorIdCard);
router.post('/register', optionalVerifyToken, validateDto(registerVisitorSchema), VisitorController.registerVisitor);
router.get('/:id/pass', verifyToken, requireRole(['ADMIN']), VisitorController.getVisitorPass);
router.get('/:id', verifyToken, requireRole(['ADMIN']), VisitorController.getVisitorPass);
router.post('/:id/cancel', verifyToken, requireRole(['ADMIN']), validateDto(cancelVisitorSchema), VisitorController.cancelVisitor);

router.get('/', verifyToken, requireRole(['ADMIN']), VisitorController.listVisitors);
router.patch('/:id/status', verifyToken, requireRole(['ADMIN']), validateDto(updateVisitorStatusSchema), VisitorController.updateVisitorStatus);

export default router;

