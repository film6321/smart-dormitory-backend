import { Router } from 'express';
import multer from 'multer';
import { AppError } from '../../middlewares/error-handler';
import { requireRole, verifyToken } from '../../middlewares/auth-jwt';
import { validateDto } from '../../middlewares/dto-validation';
import { BillingController } from './billing.controller';
import { generateRoomBillSchema, updateBillStatusSchema } from './billing.dto';

const router = Router();

const slipUpload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 5 * 1024 * 1024 },
	fileFilter: (_req, file, callback) => {
		if (!new Set(['image/jpeg', 'image/png', 'image/webp']).has(file.mimetype)) {
			callback(new AppError('Only JPG, PNG, and WebP slip images are allowed', 400));
			return;
		}

		callback(null, true);
	},
});

router.get('/', verifyToken, BillingController.listBills);
router.get('/report', verifyToken, requireRole(['ADMIN']), BillingController.getBillingReport);
router.get('/:id/payment-qr', verifyToken, BillingController.generatePaymentQr);
router.get('/room-info/:roomNumber', verifyToken, requireRole(['ADMIN']), BillingController.getRoomBillingInfo);
router.post('/generate-room-bill', verifyToken, requireRole(['ADMIN']), validateDto(generateRoomBillSchema), BillingController.generateRoomBills);
router.post('/:id/upload-slip', verifyToken, slipUpload.single('slipImage'), BillingController.uploadSlip);
router.post('/:id/upload', verifyToken, slipUpload.single('slipImage'), BillingController.uploadSlip); // Alias route for SYSTEM-BLOCK-DIAGRAM.md
router.patch('/:id/status', verifyToken, requireRole(['ADMIN']), validateDto(updateBillStatusSchema), BillingController.updateBillStatus);
router.delete('/:id', verifyToken, requireRole(['ADMIN']), BillingController.deleteBill);

export default router;

