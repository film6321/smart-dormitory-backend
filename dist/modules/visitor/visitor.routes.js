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
const visitor_controller_1 = require("./visitor.controller");
const visitor_dto_1 = require("./visitor.dto");
const router = (0, express_1.Router)();
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
router.post('/scan-id-card', auth_jwt_1.optionalVerifyToken, uploadIdCardImage, visitor_controller_1.VisitorController.scanVisitorIdCard);
router.post('/verify-id-card', auth_jwt_1.optionalVerifyToken, uploadIdCardImage, visitor_controller_1.VisitorController.scanVisitorIdCard);
router.post('/verify', auth_jwt_1.optionalVerifyToken, uploadIdCardImage, visitor_controller_1.VisitorController.scanVisitorIdCard);
router.post('/register', auth_jwt_1.optionalVerifyToken, (0, dto_validation_1.validateDto)(visitor_dto_1.registerVisitorSchema), visitor_controller_1.VisitorController.registerVisitor);
router.get('/:id/pass', auth_jwt_1.optionalVerifyToken, visitor_controller_1.VisitorController.getVisitorPass);
router.get('/:id', auth_jwt_1.optionalVerifyToken, visitor_controller_1.VisitorController.getVisitorPass);
router.post('/:id/cancel', auth_jwt_1.optionalVerifyToken, (0, dto_validation_1.validateDto)(visitor_dto_1.cancelVisitorSchema), visitor_controller_1.VisitorController.cancelVisitor);
router.get('/', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), visitor_controller_1.VisitorController.listVisitors);
router.patch('/:id/status', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), (0, dto_validation_1.validateDto)(visitor_dto_1.updateVisitorStatusSchema), visitor_controller_1.VisitorController.updateVisitorStatus);
exports.default = router;
