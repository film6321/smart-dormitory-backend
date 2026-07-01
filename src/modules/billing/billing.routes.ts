import { Router } from 'express';
import { requireRole, verifyToken } from '../../middlewares/auth-jwt';
import { validateDto } from '../shared/dto-validation';
import { BillingController } from './billing.controller';
import { updateBillStatusSchema, uploadSlipSchema } from './billing.dto';

const router = Router();

router.get('/', verifyToken, BillingController.listBills);
router.post('/:id/upload-slip', verifyToken, validateDto(uploadSlipSchema), BillingController.uploadSlip);
router.patch('/:id/status', verifyToken, requireRole(['ADMIN']), validateDto(updateBillStatusSchema), BillingController.updateBillStatus);

export default router;
