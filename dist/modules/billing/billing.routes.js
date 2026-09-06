"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const error_handler_1 = require("../../middlewares/error-handler");
const auth_jwt_1 = require("../../middlewares/auth-jwt");
const dto_validation_1 = require("../shared/dto-validation");
const billing_controller_1 = require("./billing.controller");
const billing_dto_1 = require("./billing.dto");
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
router.get('/', auth_jwt_1.verifyToken, billing_controller_1.BillingController.listBills);
router.get('/:id/payment-qr', auth_jwt_1.verifyToken, billing_controller_1.BillingController.generatePaymentQr);
router.get('/room-info/:roomNumber', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), billing_controller_1.BillingController.getRoomBillingInfo);
router.post('/generate-room-bill', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), (0, dto_validation_1.validateDto)(billing_dto_1.generateRoomBillSchema), billing_controller_1.BillingController.generateRoomBills);
router.post('/:id/upload-slip', auth_jwt_1.verifyToken, slipUpload.single('slipImage'), billing_controller_1.BillingController.uploadSlip);
router.post('/:id/upload', auth_jwt_1.verifyToken, slipUpload.single('slipImage'), billing_controller_1.BillingController.uploadSlip); // Alias route for SYSTEM-BLOCK-DIAGRAM.md
router.patch('/:id/status', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), (0, dto_validation_1.validateDto)(billing_dto_1.updateBillStatusSchema), billing_controller_1.BillingController.updateBillStatus);
router.delete('/:id', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), billing_controller_1.BillingController.deleteBill);
exports.default = router;
