"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_jwt_1 = require("../../middlewares/auth-jwt");
const dto_validation_1 = require("../shared/dto-validation");
const billing_controller_1 = require("./billing.controller");
const billing_dto_1 = require("./billing.dto");
const router = (0, express_1.Router)();
router.get('/', auth_jwt_1.verifyToken, billing_controller_1.BillingController.listBills);
router.post('/:id/upload-slip', auth_jwt_1.verifyToken, (0, dto_validation_1.validateDto)(billing_dto_1.uploadSlipSchema), billing_controller_1.BillingController.uploadSlip);
router.post('/:id/upload', auth_jwt_1.verifyToken, (0, dto_validation_1.validateDto)(billing_dto_1.uploadSlipSchema), billing_controller_1.BillingController.uploadSlip); // Alias route for SYSTEM-BLOCK-DIAGRAM.md
router.patch('/:id/status', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), (0, dto_validation_1.validateDto)(billing_dto_1.updateBillStatusSchema), billing_controller_1.BillingController.updateBillStatus);
exports.default = router;
