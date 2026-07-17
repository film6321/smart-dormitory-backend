"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const error_handler_1 = require("../../middlewares/error-handler");
const users_repository_1 = require("./users.repository");
class UsersService {
    static async listUsers(db) {
        return users_repository_1.UsersRepository.listUsers(db);
    }
    static async getUserById(id, db) {
        return users_repository_1.UsersRepository.getUserById(id, db);
    }
    static async createUser(data, db) {
        const email = data.email.trim().toLowerCase();
        const existing = await users_repository_1.UsersRepository.findByEmail(email, db);
        if (existing) {
            throw new error_handler_1.AppError('Email already exists', 409);
        }
        if (!data.password || data.password.length < 8) {
            throw new error_handler_1.AppError('Password must be at least 8 characters', 400);
        }
        const hashedPassword = await bcrypt_1.default.hash(data.password, 10);
        return users_repository_1.UsersRepository.createUser({
            email,
            password: hashedPassword,
            firstName: data.firstName?.trim() ?? null,
            lastName: data.lastName?.trim() ?? null,
            role: (data.role ?? 'STUDENT').toUpperCase(),
        }, db);
    }
    static async updateUser(id, data, db) {
        const payload = {};
        if (data.email)
            payload.email = data.email.trim().toLowerCase();
        if (data.firstName !== undefined)
            payload.firstName = data.firstName?.trim() ?? null;
        if (data.lastName !== undefined)
            payload.lastName = data.lastName?.trim() ?? null;
        if (data.role)
            payload.role = data.role.toUpperCase();
        if (data.password) {
            payload.password = await bcrypt_1.default.hash(data.password, 10);
        }
        return users_repository_1.UsersRepository.updateUser(id, payload, db);
    }
    static async deleteUser(id, db) {
        return users_repository_1.UsersRepository.deleteUser(id, db);
    }
}
exports.UsersService = UsersService;
