"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const auth_jwt_1 = require("../../middlewares/auth-jwt");
const error_handler_1 = require("../../middlewares/error-handler");
const tenants_controller_1 = require("./tenants.controller");
const router = (0, express_1.Router)();
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit as requested on frontend
    },
    fileFilter: (_req, file, callback) => {
        if (!allowedMimeTypes.has(file.mimetype)) {
            callback(new error_handler_1.AppError('Only JPG, PNG, WebP, and PDF files are allowed', 400));
            return;
        }
        callback(null, true);
    },
});
const uploadFields = upload.fields([
    { name: 'idCard', maxCount: 1 },
    { name: 'paymentSlip', maxCount: 1 },
]);
router.get('/', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), tenants_controller_1.TenantsController.listTenants);
router.get('/payment-qr/:roomNumber', auth_jwt_1.verifyToken, tenants_controller_1.TenantsController.generatePaymentQr);
router.get('/me', auth_jwt_1.verifyToken, tenants_controller_1.TenantsController.getMyTenant);
router.get('/me/documents/:documentType', auth_jwt_1.verifyToken, tenants_controller_1.TenantsController.getMyDocument);
router.get('/:id/documents/:documentType', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), tenants_controller_1.TenantsController.getTenantDocumentById);
router.get('/:id', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), tenants_controller_1.TenantsController.getTenantById);
router.post('/upload-documents', auth_jwt_1.verifyToken, uploadFields, tenants_controller_1.TenantsController.uploadDocuments);
router.post('/apply', auth_jwt_1.verifyToken, tenants_controller_1.TenantsController.submitApplication);
router.post('/', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), tenants_controller_1.TenantsController.createTenant);
router.patch('/:id', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), tenants_controller_1.TenantsController.updateTenant);
router.delete('/:id', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), tenants_controller_1.TenantsController.deleteTenant);
exports.default = router;
