import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { AuthenticatedRequest, requireRole, verifyToken } from '../../middlewares/auth-jwt';
import { createRateLimitStore } from '../../shared/rate-limit-store';
import { validateDto } from '../../middlewares/dto-validation';
import { MaintenanceController } from './maintenance.controller';
import { createMaintenanceTicketSchema, updateMaintenanceStatusSchema } from './maintenance.dto';
import { AppError } from '../../middlewares/error-handler';

const router = Router();
const submissionLimiter = rateLimit({
  store: createRateLimitStore('rl:maintenance:submission:'),
  windowMs: 60_000,
  limit: 10,
  keyGenerator: (req: AuthenticatedRequest) => String(req.user?.id),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError('ส่งคำขอแจ้งซ่อมถี่เกินไป กรุณารอ 1 นาทีแล้วลองใหม่', 429)),
});

const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (_req, file, callback) => {
    if (!allowedImageTypes.has(file.mimetype)) {
      callback(new AppError('Only JPG, PNG, and WebP images are allowed', 400));
      return;
    }
    callback(null, true);
  },
});

router.post('/', verifyToken, submissionLimiter, validateDto(createMaintenanceTicketSchema), MaintenanceController.createTicket);
router.get('/', verifyToken, MaintenanceController.listTickets);
router.post('/:id/confirm', verifyToken, requireRole(['STUDENT']), MaintenanceController.confirmTicket);
router.patch('/:id/status', verifyToken, requireRole(['ADMIN']), validateDto(updateMaintenanceStatusSchema), MaintenanceController.updateTicketStatus);
router.delete('/:id', verifyToken, requireRole(['ADMIN']), MaintenanceController.deleteTicket);

// Image uploading & downloading routes
router.post('/upload', verifyToken, submissionLimiter, upload.single('image'), MaintenanceController.uploadImage);
router.get('/images/:filename', verifyToken, requireRole(['ADMIN']), MaintenanceController.serveImage);

export default router;
