"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_jwt_1 = require("../../middlewares/auth-jwt");
const notification_preferences_controller_1 = __importDefault(require("./notification-preferences.controller"));
const router = (0, express_1.Router)();
router.get('/', auth_jwt_1.verifyToken, notification_preferences_controller_1.default.listPreferences);
router.put('/', auth_jwt_1.verifyToken, notification_preferences_controller_1.default.upsertPreference);
exports.default = router;
