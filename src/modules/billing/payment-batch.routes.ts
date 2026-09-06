import { Router } from 'express';
import multer from 'multer';
import { AppError } from '../../middlewares/error-handler';
import { requireRole, verifyToken } from '../../middlewares/auth-jwt';
import { PaymentBatchController } from './payment-batch.controller';

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

router.post('/', verifyToken, PaymentBatchController.create);
router.get('/:id', verifyToken, PaymentBatchController.getById);
router.get('/:id/payment-qr', verifyToken, PaymentBatchController.generateQr);
router.get('/:id/status', verifyToken, PaymentBatchController.getById);
router.post('/:id/upload-slip', verifyToken, slipUpload.single('slipImage'), PaymentBatchController.uploadSlip);
router.get('/admin/bills/:billId/payment-details', verifyToken, requireRole(['ADMIN']), PaymentBatchController.getAdminBillPaymentDetails);
router.get('/admin/bills/:billId/slip', verifyToken, requireRole(['ADMIN']), PaymentBatchController.getAdminBillSlip);

export default router;