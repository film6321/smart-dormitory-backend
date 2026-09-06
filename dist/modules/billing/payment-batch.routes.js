"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const error_handler_1 = require("../../middlewares/error-handler");
const auth_jwt_1 = require("../../middlewares/auth-jwt");
const payment_batch_controller_1 = require("./payment-batch.controller");
const router = (0, express_1.Router)();
const slipUpload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
        if (!new Set(['image/jpeg', 'image/png', 'image/webp']).has(file.mimetype)) {
            callback(new error_handler_1.AppError('Only JPG, PNG, and WebP slip images are allowed', 400));
            return;
        }
        callback(null, true);
    },
});
router.post('/', auth_jwt_1.verifyToken, payment_batch_controller_1.PaymentBatchController.create);
router.get('/:id', auth_jwt_1.verifyToken, payment_batch_controller_1.PaymentBatchController.getById);
router.get('/:id/payment-qr', auth_jwt_1.verifyToken, payment_batch_controller_1.PaymentBatchController.generateQr);
router.get('/:id/status', auth_jwt_1.verifyToken, payment_batch_controller_1.PaymentBatchController.getById);
router.post('/:id/upload-slip', auth_jwt_1.verifyToken, slipUpload.single('slipImage'), payment_batch_controller_1.PaymentBatchController.uploadSlip);
router.get('/admin/bills/:billId/payment-details', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), payment_batch_controller_1.PaymentBatchController.getAdminBillPaymentDetails);
router.get('/admin/bills/:billId/slip', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), payment_batch_controller_1.PaymentBatchController.getAdminBillSlip);
exports.default = router;
