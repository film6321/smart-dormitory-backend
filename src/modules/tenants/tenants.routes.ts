import { requirePrivacyConsent } from '../../middlewares/privacy-consent';
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

router.get('/draft', verifyToken, TenantsController.getDraft);
router.patch('/draft', verifyToken, requirePrivacyConsent('HOUSING'), TenantsController.saveDraft);
router.get('/draft/payment-qr/:roomNumber', verifyToken, requirePrivacyConsent('HOUSING'), TenantsController.generateDraftQr);
router.post('/draft/upload-identity', verifyToken, requirePrivacyConsent('HOUSING'), uploadFields, TenantsController.uploadDocuments);
router.post('/draft/upload-slip', verifyToken, requirePrivacyConsent('HOUSING'), uploadFields, TenantsController.uploadDocuments);
router.post('/draft/refund-request', verifyToken, requireRole(['STUDENT']), requirePrivacyConsent('HOUSING'), TenantsController.requestHousingRefund);
router.get('/drafts/refunds', verifyToken, requireRole(['ADMIN']), TenantsController.listHousingRefunds);
router.post('/drafts/:draftId/refunds', verifyToken, requireRole(['ADMIN']), upload.single('proof'), TenantsController.recordHousingRefund);
router.post('/drafts/:draftId/refund-requests/:requestId/reject', verifyToken, requireRole(['ADMIN']), TenantsController.rejectHousingRefund);
router.get('/drafts/refunds/:refundId/proof', verifyToken, requireRole(['ADMIN']), TenantsController.getHousingRefundProof);

router.get('/', verifyToken, requireRole(['ADMIN']), TenantsController.listTenants);
router.get('/payment-qr/:roomNumber', verifyToken, requirePrivacyConsent('HOUSING'), TenantsController.generatePaymentQr);
router.post('/me/face-enrollment/complete', verifyToken, requireRole(['STUDENT']), requirePrivacyConsent('FACE_ENROLLMENT'), TenantsController.completeFaceEnrollment);
router.get('/me', verifyToken, TenantsController.getMyTenant);
router.get('/me/documents/:documentType', verifyToken, TenantsController.getMyDocument);
router.get('/:id/documents/:documentType', verifyToken, requireRole(['ADMIN']), TenantsController.getTenantDocumentById);
router.get('/:id', verifyToken, requireRole(['ADMIN']), TenantsController.getTenantById);
router.post('/upload-documents', verifyToken, requirePrivacyConsent('HOUSING'), uploadFields, TenantsController.uploadDocuments);
router.post('/apply', verifyToken, requirePrivacyConsent('HOUSING'), TenantsController.submitApplication);
router.post('/', verifyToken, requireRole(['ADMIN']), TenantsController.createTenant);
router.patch('/:id', verifyToken, requireRole(['ADMIN']), TenantsController.updateTenant);
router.delete('/:id', verifyToken, requireRole(['ADMIN']), TenantsController.deleteTenant);

export default router;
