"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = exports.verifyToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const error_handler_1 = require("./error-handler");
const env_1 = require("../shared/env");
// 1. Middleware สำหรับตรวจ Token ว่าส่งมาไหม และเป็นของจริงไหม
const verifyToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1]; // รับค่าจาก Header แบบ "Bearer <token>"
    const cookieToken = (req.headers.cookie ?? '')
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('access_token='))
        ?.slice('access_token='.length);
    const queryToken = typeof req.query?.token === 'string' ? req.query.token.trim() : undefined;
    const resolvedToken = token || cookieToken || queryToken;
    if (!resolvedToken) {
        return next(new error_handler_1.AppError('ไม่อนุญาตให้เข้าถึง: ไม่พบ Token', 401));
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(resolvedToken, (0, env_1.getJwtSecret)());
        // แปะข้อมูล user ลงใน Request เพื่อให้ Controller เอาไปใช้งานต่อได้
        req.user = decoded;
        next();
    }
    catch {
        return next(new error_handler_1.AppError('ไม่อนุญาตให้เข้าถึง: Token หมดอายุหรือไม่ถูกต้อง', 401));
    }
};
exports.verifyToken = verifyToken;
// 2. Middleware แยกส่วนที่เอาไว้ตรวจจำกัดสิทธิ์เฉพาะบาง Role เช่น ADMIN เท่านั้น
const requireRole = (roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return next(new error_handler_1.AppError('ไม่อนุญาตให้เข้าถึง: ไม่พบข้อมูลผู้ใช้', 401));
        }
        if (!roles.includes(req.user.role)) {
            return next(new error_handler_1.AppError('ถูกปฏิเสธ: คุณไม่มีสิทธิ์เข้าถึงส่วนนี้', 403));
        }
        next();
    };
};
exports.requireRole = requireRole;
