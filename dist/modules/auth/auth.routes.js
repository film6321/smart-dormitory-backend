"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const auth_jwt_1 = require("../../middlewares/auth-jwt");
const api_response_1 = require("../../shared/api-response");
const auth_controller_1 = require("./auth.controller");
const router = (0, express_1.Router)();
// ตั้งค่า Rate Limiter ที่เข็มแข็งสำหรับ Login (ป้องกัน Brute Force)
const loginLimiter = (0, express_rate_limit_1.default)({
    windowMs: 5 * 60 * 1000, // 5 นาที
    max: 5, // จำกัด 5 ครั้ง
    message: { status: 429, message: 'Too many login attempts, please try again in 5 minutes' },
    skipSuccessfulRequests: true, // ไม่นับ login สำเร็จ
    standardHeaders: true,
    legacyHeaders: false,
});
// ตั้งค่า Rate Limiter สำหรับ Register
const registerLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000, // 1 ชั่วโมง
    max: 3, // จำกัด 3 ครั้ง
    message: { status: 429, message: 'Too many registration attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});
// เส้นทางแบบเข้าถึงได้อิสระ (Public Routes) - มี Rate Limiting
router.post('/login', loginLimiter, auth_controller_1.AuthController.login);
router.post('/register', registerLimiter, auth_controller_1.AuthController.register);
// เส้นทางตัวอย่างเพื่อทดสอบ Token
router.get('/me', auth_jwt_1.verifyToken, (req, res) => {
    res.json((0, api_response_1.createResponse)(200, 'ดึงข้อมูลโปรไฟล์ได้สำเร็จ', { user: req.user }));
});
// เส้นทางตัวอย่างที่ให้เฉพาะ Admin เข้ามาได้
router.get('/admin-only', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), (req, res) => {
    res.json((0, api_response_1.createResponse)(200, 'ยินดีต้อนรับท่านผู้ดูแลระบบ'));
});
exports.default = router;
