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
// Token check middleware specifically for FaceGate Edge or fallback to user JWTs
const verifyFaceGateToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    const expectedToken = process.env.FACE_API_KEY || 'face-recognition-secret-key-change-me-in-production';
    if (token && token === expectedToken) {
        req.user = { id: 0, role: 'ADMIN' };
        return next();
    }
    // Fallback to standard admin check
    (0, auth_jwt_1.verifyToken)(req, res, next);
};
const faceLimiter = (0, express_rate_limit_1.default)({
    store: (0, rate_limit_store_1.createRateLimitStore)('rl:face:lock:'),
    windowMs: 60 * 1000,
    max: 100, // 100 requests per minute to support frequent camera captures
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
const authorizeFaceRegistration = (req, res, next) => {
    const requestedUserId = Number(req.body.userId || req.body.user_id);
    if (req.user?.role === 'ADMIN' || req.user?.id === requestedUserId) {
        return next();
    }
    return next(new error_handler_1.AppError('You can only register your own face template', 403));
};
// ── Web Dashboard/Legacy API Endpoints ──
router.post('/register', auth_jwt_1.verifyToken, uploadFaceImage, authorizeFaceRegistration, face_verification_controller_1.FaceVerificationController.register);
router.post('/verify', faceLimiter, uploadFaceImage, face_verification_controller_1.FaceVerificationController.verify);
router.post('/verify-image', faceLimiter, uploadFaceImage, face_verification_controller_1.FaceVerificationController.verify);
// ── C# FaceGate.Edge Integration Endpoints ──
router.get('/embeddings', verifyFaceGateToken, face_verification_controller_1.FaceVerificationController.embeddings);
router.get('/enrollment/pending', verifyFaceGateToken, face_verification_controller_1.FaceVerificationController.pending);
router.get('/enrollment/photo/:id', verifyFaceGateToken, face_verification_controller_1.FaceVerificationController.photo);
router.post('/enrollment/:studentId/embeddings', verifyFaceGateToken, face_verification_controller_1.FaceVerificationController.storeEmbeddings);
router.post('/attendance/scan', verifyFaceGateToken, face_verification_controller_1.FaceVerificationController.scan);
router.post('/devices/heartbeat', verifyFaceGateToken, face_verification_controller_1.FaceVerificationController.heartbeat);
router.post('/door-command', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), face_verification_controller_1.FaceVerificationController.doorCommand);
router.post('/devices/live-frame', verifyFaceGateToken, face_verification_controller_1.FaceVerificationController.liveFrame);
// Generic detections endpoint (from custom detectors like YOLO)
router.post('/detections', verifyFaceGateToken, face_verification_controller_1.FaceVerificationController.detections);
router.get('/live-stream', face_verification_controller_1.FaceVerificationController.liveStream);
router.get('/devices', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), face_verification_controller_1.FaceVerificationController.devices);
router.get('/scan-history', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), face_verification_controller_1.FaceVerificationController.scanHistory);
router.get('/events', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), face_verification_controller_1.FaceVerificationController.events);
// ── Template Management Endpoints ──
router.get('/:templateId', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), face_verification_controller_1.FaceVerificationController.getTemplate);
router.put('/:templateId', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), uploadFaceImage, face_verification_controller_1.FaceVerificationController.updateTemplate);
router.delete('/:templateId', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), face_verification_controller_1.FaceVerificationController.deleteTemplate);
exports.default = router;
