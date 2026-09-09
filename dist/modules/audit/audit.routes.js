"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_jwt_1 = require("../../middlewares/auth-jwt");
const audit_controller_1 = require("./audit.controller");
const router = (0, express_1.Router)();
router.get('/', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), audit_controller_1.AuditController.list);
exports.default = router;
