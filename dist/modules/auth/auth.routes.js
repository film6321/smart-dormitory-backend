"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importStar(require("express-rate-limit"));
const auth_jwt_1 = require("../../middlewares/auth-jwt");
const api_response_1 = require("../../shared/api-response");
const rate_limit_store_1 = require("../../shared/rate-limit-store");
const auth_controller_1 = require("./auth.controller");
const router = (0, express_1.Router)();
// ตั้งค่า Rate Limiter ที่เข็มแข็งสำหรับ Login (ป้องกัน Brute Force)
const loginLimiter = (0, express_rate_limit_1.default)({
    store: (0, rate_limit_store_1.createRateLimitStore)('rl:auth:login:'),
    windowMs: 5 * 60 * 1000, // 5 นาที
    max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 5), // จำกัด 5 ครั้งต่อ 1 IP
    keyGenerator: (req) => (0, express_rate_limit_1.ipKeyGenerator)(req.ip ?? '127.0.0.1'),
    message: { status: 429, message: 'Too many login attempts, please try again in 5 minutes' },
    skipSuccessfulRequests: true, // ไม่นับ login สำเร็จ
    standardHeaders: true,
    legacyHeaders: false,
});
// ตั้งค่า Rate Limiter สำหรับ Register
const registerLimiter = (0, express_rate_limit_1.default)({
    store: (0, rate_limit_store_1.createRateLimitStore)('rl:auth:register:'),
    windowMs: 60 * 60 * 1000, // 1 ชั่วโมง
    max: Number(process.env.REGISTER_RATE_LIMIT_MAX || 3), // จำกัด 3 ครั้งต่อ 1 IP
    keyGenerator: (req) => (0, express_rate_limit_1.ipKeyGenerator)(req.ip ?? '127.0.0.1'),
    message: { status: 429, message: 'Too many registration attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});
// เส้นทางแบบเข้าถึงได้อิสระ (Public Routes) - มี Rate Limiting
router.post('/login', loginLimiter, auth_controller_1.AuthController.login);
router.post('/register', registerLimiter, auth_controller_1.AuthController.register);
router.post('/heartbeat', auth_jwt_1.verifyToken, auth_controller_1.AuthController.heartbeat);
router.post('/logout', auth_jwt_1.verifyToken, auth_controller_1.AuthController.logout);
// เส้นทางตัวอย่างเพื่อทดสอบ Token
router.get('/me', auth_jwt_1.verifyToken, (req, res) => {
    res.json((0, api_response_1.createResponse)(200, 'ดึงข้อมูลโปรไฟล์ได้สำเร็จ', { user: req.user }));
});
// เส้นทางตัวอย่างที่ให้เฉพาะ Admin เข้ามาได้
router.get('/admin-only', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), (req, res) => {
    res.json((0, api_response_1.createResponse)(200, 'ยินดีต้อนรับท่านผู้ดูแลระบบ'));
});
exports.default = router;
