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
const face_verification_controller_1 = require("./face-verification.controller");
const router = (0, express_1.Router)();
const faceLimiter = (0, express_rate_limit_1.default)({
    store: (0, rate_limit_store_1.createRateLimitStore)('rl:face:lock:'),
    windowMs: 60 * 1000,
    max: 20, // 20 requests per minute
    message: { statusCode: 429, message: 'Too many requests, please try again later' },
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
const uploadFaceImage = (req, res, next) => {
    upload.fields([
        { name: 'file', maxCount: 1 },
        { name: 'image', maxCount: 1 },
    ])(req, res, (error) => {
        if (error instanceof multer_1.default.MulterError) {
            next(new error_handler_1.AppError(error.code === 'LIMIT_FILE_SIZE' ? 'Image file must be 5MB or smaller' : error.message, 400));
            return;
        }
        next(error);
    });
};
// Endpoints
router.post('/register', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), uploadFaceImage, face_verification_controller_1.FaceVerificationController.register);
router.post('/verify', faceLimiter, uploadFaceImage, face_verification_controller_1.FaceVerificationController.verify);
router.get('/:templateId', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), face_verification_controller_1.FaceVerificationController.getTemplate);
router.put('/:templateId', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), uploadFaceImage, face_verification_controller_1.FaceVerificationController.updateTemplate);
router.delete('/:templateId', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), face_verification_controller_1.FaceVerificationController.deleteTemplate);
exports.default = router;
