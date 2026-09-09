"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const logger_1 = require("../../logger");
const error_handler_1 = require("../../middlewares/error-handler");
const env_1 = require("../../shared/env");
const presence_1 = require("../../shared/presence");
const settings_service_1 = require("../settings/settings.service");
const auth_repository_1 = require("./auth.repository");
// ฟังก์ชันตรวจสอบความเข็มแข็งของรหัสผ่าน
const validatePassword = async (password) => {
    const policy = (await (0, settings_service_1.getSettingValue)('passwordPolicy')).trim().toLowerCase();
    if (!password || password.length < 8) {
        throw new error_handler_1.AppError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร', 400);
    }
    if (policy === 'ผ่อนปรน' || policy === 'relaxed')
        return;
    if (!/[A-Z]/.test(password)) {
        throw new error_handler_1.AppError('รหัสผ่านต้องมีตัวอักษรใหญ่อย่างน้อย 1 ตัว', 400);
    }
    if (!/[a-z]/.test(password)) {
        throw new error_handler_1.AppError('รหัสผ่านต้องมีตัวอักษรเล็กอย่างน้อย 1 ตัว', 400);
    }
    if (!/[0-9]/.test(password)) {
        throw new error_handler_1.AppError('รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว', 400);
    }
    if (policy === 'เข้มงวด' || policy === 'strict') {
        if (!/[^A-Za-z0-9]/.test(password)) {
            throw new error_handler_1.AppError('รหัสผ่านแบบเข้มงวดต้องมีอักขระพิเศษอย่างน้อย 1 ตัว', 400);
        }
    }
};
const getPrismaErrorCode = (error) => {
    if (!error || typeof error !== 'object') {
        return undefined;
    }
    return error.code;
};
const normalizeLastLogin = (value) => {
    if (!value) {
        return '-';
    }
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) {
        return '-';
    }
    return date.toISOString();
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
        const sessionTimeoutMinutes = Number(await (0, settings_service_1.getSettingValue)('sessionTimeoutMinutes')) || 30;
        const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role }, (0, env_1.getJwtSecret)(), { expiresIn: `${sessionTimeoutMinutes}m` });
        const lastLogin = new Date();
        try {
            await auth_repository_1.AuthRepository.updateUser(user.id, { lastLogin }, undefined);
        }
        catch (error) {
            if (getPrismaErrorCode(error) !== 'P2022') {
                throw error;
            }
            logger_1.logger.warn({ error, userId: user.id }, 'lastLogin column is not available yet, skipping login timestamp update');
        }
        await (0, presence_1.markUserOnline)(user.id, lastLogin);
        return {
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                role: user.role,
                firstName: user.firstName,
                lastName: user.lastName,
                lastLogin: normalizeLastLogin(lastLogin),
                isOnline: true,
            },
            token,
            sessionTimeoutMinutes,
        };
    }
    static async register(data) {
        const { email, password, firstName, lastName, role, username } = data;
        const normalizedUsername = typeof username === 'string' ? username.trim() : undefined;
        const finalUsername = normalizedUsername ? normalizedUsername : undefined;
        // ตรวจสอบว่าอีเมลซ้ำไหม
        const existing = await auth_repository_1.AuthRepository.findByEmail(email);
        if (existing) {
            throw new error_handler_1.AppError('อีเมลนี้ถูกใช้งานแล้ว', 400);
        }
        if (finalUsername) {
            try {
                const existingUsername = await auth_repository_1.AuthRepository.findByUsername(finalUsername);
                if (existingUsername) {
                    throw new error_handler_1.AppError('ชื่อผู้ใช้นี้ถูกใช้งานแล้ว', 400);
                }
            }
            catch (error) {
                if (getPrismaErrorCode(error) !== 'P2022') {
                    throw error;
                }
                logger_1.logger.warn({ error }, 'Username column is not available yet, skipping username uniqueness check');
            }
        }
        // ตรวจสอบความเข็มแข็งของรหัสผ่าน
        await validatePassword(password);
        // แฮชรหัสผ่านเพื่อความปลอดภัยก่อนบันทึกลง Database
        const hashedPassword = await bcrypt_1.default.hash(password, 10);
        const createPayload = {
            email,
            password: hashedPassword,
            firstName,
            lastName,
            role: role || 'STUDENT',
            username: finalUsername,
        };
        try {
            const user = await auth_repository_1.AuthRepository.createUser(createPayload);
            return { id: user.id, email: user.email, role: user.role };
        }
        catch (error) {
            if (finalUsername && getPrismaErrorCode(error) === 'P2022') {
                logger_1.logger.warn({ error }, 'Username column is not available yet, creating user without username');
                const user = await auth_repository_1.AuthRepository.createUser({
                    email,
                    password: hashedPassword,
                    firstName,
                    lastName,
                    role: role || 'STUDENT',
                });
                return { id: user.id, email: user.email, role: user.role };
            }
            throw error;
        }
    }
}
exports.AuthService = AuthService;
