"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const auth_jwt_1 = require("../../middlewares/auth-jwt");
const dto_validation_1 = require("../shared/dto-validation");
const maintenance_controller_1 = require("./maintenance.controller");
const maintenance_dto_1 = require("./maintenance.dto");
const error_handler_1 = require("../../middlewares/error-handler");
const router = (0, express_1.Router)();
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (_req, file, callback) => {
        if (!allowedImageTypes.has(file.mimetype)) {
            callback(new error_handler_1.AppError('Only JPG, PNG, and WebP images are allowed', 400));
            return;
        }
        callback(null, true);
    },
});
router.post('/', auth_jwt_1.verifyToken, (0, dto_validation_1.validateDto)(maintenance_dto_1.createMaintenanceTicketSchema), maintenance_controller_1.MaintenanceController.createTicket);
router.get('/', auth_jwt_1.verifyToken, maintenance_controller_1.MaintenanceController.listTickets);
router.patch('/:id/status', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), (0, dto_validation_1.validateDto)(maintenance_dto_1.updateMaintenanceStatusSchema), maintenance_controller_1.MaintenanceController.updateTicketStatus);
router.delete('/:id', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), maintenance_controller_1.MaintenanceController.deleteTicket);
// Image uploading & downloading routes
router.post('/upload', auth_jwt_1.verifyToken, upload.single('image'), maintenance_controller_1.MaintenanceController.uploadImage);
router.get('/images/:filename', maintenance_controller_1.MaintenanceController.serveImage);
exports.default = router;
