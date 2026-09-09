"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_jwt_1 = require("../../middlewares/auth-jwt");
const settings_controller_1 = require("./settings.controller");
const router = (0, express_1.Router)();
router.get('/', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), settings_controller_1.SettingsController.get);
router.patch('/', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), settings_controller_1.SettingsController.update);
exports.default = router;
