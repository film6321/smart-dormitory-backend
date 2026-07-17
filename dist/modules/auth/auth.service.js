"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const error_handler_1 = require("../../middlewares/error-handler");
const env_1 = require("../../shared/env");
const auth_repository_1 = require("./auth.repository");
// ฟังก์ชันตรวจสอบความเข็มแข็งของรหัสผ่าน
const validatePassword = (password) => {
    if (!password || password.length < 8) {
        throw new error_handler_1.AppError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร', 400);
    }
    if (!/[A-Z]/.test(password)) {
        throw new error_handler_1.AppError('รหัสผ่านต้องมีตัวอักษรใหญ่อย่างน้อย 1 ตัว', 400);
    }
    if (!/[a-z]/.test(password)) {
        throw new error_handler_1.AppError('รหัสผ่านต้องมีตัวอักษรเล็กอย่างน้อย 1 ตัว', 400);
    }
    if (!/[0-9]/.test(password)) {
        throw new error_handler_1.AppError('รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว', 400);
    }
};
class AuthService {
    static async login(email, passwordString) {
        const user = await auth_repository_1.AuthRepository.findByEmail(email);
        if (!user) {
            throw new error_handler_1.AppError('อีเมลหรือรหัสผ่านไม่ถูกต้อง', 401);
        }
        const isValid = await bcrypt_1.default.compare(passwordString, user.password);
        if (!isValid) {
            throw new error_handler_1.AppError('อีเมลหรือรหัสผ่านไม่ถูกต้อง', 401);
        }
        // เจนเนอเรต JWT Token (หมดอายุใน 1 วัน)
        const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role }, (0, env_1.getJwtSecret)(), { expiresIn: '1d' });
        return {
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                firstName: user.firstName,
                lastName: user.lastName,
            },
            token
        };
    }
    static async register(data) {
        const { email, password, firstName, lastName, role } = data;
        // ตรวจสอบว่าอีเมลซ้ำไหม
        const existing = await auth_repository_1.AuthRepository.findByEmail(email);
        if (existing) {
            throw new error_handler_1.AppError('อีเมลนี้ถูกใช้งานแล้ว', 400);
        }
        // ตรวจสอบความเข็มแข็งของรหัสผ่าน
        validatePassword(password);
        // แฮชรหัสผ่านเพื่อความปลอดภัยก่อนบันทึกลง Database
        const hashedPassword = await bcrypt_1.default.hash(password, 10);
        const user = await auth_repository_1.AuthRepository.createUser({
            email,
            password: hashedPassword,
            firstName,
            lastName,
            role: role || 'STUDENT'
        });
        return { id: user.id, email: user.email, role: user.role };
    }
}
exports.AuthService = AuthService;
