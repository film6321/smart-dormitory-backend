"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const multer_1 = __importDefault(require("multer"));
const auth_jwt_1 = require("../../middlewares/auth-jwt");
const error_handler_1 = require("../../middlewares/error-handler");
const rate_limit_store_1 = require("../../shared/rate-limit-store");
const ocr_controller_1 = require("./ocr.controller");
const router = (0, express_1.Router)();
const verifyIdCardLimiter = (0, express_rate_limit_1.default)({
    store: (0, rate_limit_store_1.createRateLimitStore)('rl:ocr:verify-id-card:'),
    windowMs: 60 * 1000,
    max: 10,
    message: { statusCode: 429, message: 'Too many OCR verification requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});
const allowedImageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024,
    },
    fileFilter: (_req, file, callback) => {
        if (!allowedImageMimeTypes.has(file.mimetype)) {
            callback(new error_handler_1.AppError('Only JPG, PNG, and WebP image files are allowed', 400));
            return;
        }
        callback(null, true);
    },
});
const uploadIdCardImage = (req, res, next) => {
    upload.fields([
        { name: 'file', maxCount: 1 },
        { name: 'image', maxCount: 1 },
        { name: 'idCard', maxCount: 1 },
        { name: 'document', maxCount: 1 },
    ])(req, res, (error) => {
        if (error instanceof multer_1.default.MulterError) {
            next(new error_handler_1.AppError(error.code === 'LIMIT_FILE_SIZE' ? 'Image file must be 5MB or smaller' : error.message, 400));
            return;
        }
        next(error);
    });
};
router.post('/verify-id-card', verifyIdCardLimiter, uploadIdCardImage, ocr_controller_1.OcrController.verifyIdCard);
router.post('/verify', verifyIdCardLimiter, uploadIdCardImage, ocr_controller_1.OcrController.verifyIdCard); // Alias route for SYSTEM-BLOCK-DIAGRAM.md
router.post('/verify-id-card/jobs', verifyIdCardLimiter, uploadIdCardImage, ocr_controller_1.OcrController.createIdCardVerificationJob);
router.get('/jobs/:jobId', verifyIdCardLimiter, ocr_controller_1.OcrController.getIdCardVerificationJob); // Alias route for SYSTEM-BLOCK-DIAGRAM.md
router.get('/verify-id-card/jobs/:jobId', verifyIdCardLimiter, ocr_controller_1.OcrController.getIdCardVerificationJob);
router.get('/id-card-verifications', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), ocr_controller_1.OcrController.listIdCardVerifications);
router.get('/id-card-verifications/:id', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), ocr_controller_1.OcrController.getIdCardVerification);
router.get('/id-card-verifications/:id/image', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), ocr_controller_1.OcrController.getIdCardVerificationImage);
router.delete('/id-card-verifications/:id', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), ocr_controller_1.OcrController.deleteIdCardVerification);
exports.default = router;
