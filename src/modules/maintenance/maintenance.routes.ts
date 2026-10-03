import { Router } from 'express';
import multer from 'multer';
import { requireRole, verifyToken } from '../../middlewares/auth-jwt';
import { validateDto } from '../../middlewares/dto-validation';
import { MaintenanceController } from './maintenance.controller';
import { createMaintenanceTicketSchema, updateMaintenanceStatusSchema } from './maintenance.dto';
import { AppError } from '../../middlewares/error-handler';

const router = Router();

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

router.post('/', verifyToken, validateDto(createMaintenanceTicketSchema), MaintenanceController.createTicket);
router.get('/', verifyToken, MaintenanceController.listTickets);
router.patch('/:id/status', verifyToken, requireRole(['ADMIN']), validateDto(updateMaintenanceStatusSchema), MaintenanceController.updateTicketStatus);
router.delete('/:id', verifyToken, requireRole(['ADMIN']), MaintenanceController.deleteTicket);

// Image uploading & downloading routes
router.post('/upload', verifyToken, upload.single('image'), MaintenanceController.uploadImage);
router.get('/images/:filename', verifyToken, requireRole(['ADMIN']), MaintenanceController.serveImage);

export default router;
