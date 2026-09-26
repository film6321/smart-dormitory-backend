import { Router } from 'express';
import multer from 'multer';
import { requireRole, verifyToken } from '../../middlewares/auth-jwt';
import { AppError } from '../../middlewares/error-handler';
import { TenantsController } from './tenants.controller';

const router = Router();

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit as requested on frontend
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new AppError('Only JPG, PNG, WebP, and PDF files are allowed', 400));
      return;
    }
    callback(null, true);
  },
});

const uploadFields = upload.fields([
  { name: 'idCard', maxCount: 1 },
  { name: 'paymentSlip', maxCount: 1 },
]);

router.get('/', verifyToken, requireRole(['ADMIN']), TenantsController.listTenants);
router.get('/payment-qr/:roomNumber', verifyToken, TenantsController.generatePaymentQr);
router.get('/me', verifyToken, TenantsController.getMyTenant);
router.get('/me/documents/:documentType', verifyToken, TenantsController.getMyDocument);
router.get('/:id/documents/:documentType', verifyToken, requireRole(['ADMIN']), TenantsController.getTenantDocumentById);
router.get('/:id', verifyToken, requireRole(['ADMIN']), TenantsController.getTenantById);
router.post('/upload-documents', verifyToken, uploadFields, TenantsController.uploadDocuments);
router.post('/apply', verifyToken, TenantsController.submitApplication);
router.post('/', verifyToken, requireRole(['ADMIN']), TenantsController.createTenant);
router.patch('/:id', verifyToken, requireRole(['ADMIN']), TenantsController.updateTenant);
router.delete('/:id', verifyToken, requireRole(['ADMIN']), TenantsController.deleteTenant);

export default router;
