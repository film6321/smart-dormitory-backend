"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const error_handler_1 = require("../../middlewares/error-handler");
const presence_1 = require("../../shared/presence");
const users_repository_1 = require("./users.repository");
class UsersService {
    static withDisplayName(user) {
        if (!user) {
            return user;
        }
        const displayName = user.username?.trim() || `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email || '';
        return {
            ...user,
            displayName,
            name: displayName,
            fullName: displayName,
            isOnline: user.isOnline ?? true,
        };
    }
    static async listUsers(db) {
        const users = await users_repository_1.UsersRepository.listUsers(db);
        const presence = await (0, presence_1.resolveUsersPresence)(users.map((user) => ({ id: user.id, lastLogin: user.lastLogin })));
        return users.map((user) => UsersService.withDisplayName({
            ...user,
            isOnline: presence[user.id]?.isOnline,
        }));
    }
    static async getUserById(id, db) {
        const user = await users_repository_1.UsersRepository.getUserById(id, db);
        const presence = await (0, presence_1.resolveUsersPresence)(user ? [{ id: user.id, lastLogin: user.lastLogin }] : []);
        return UsersService.withDisplayName(user ? {
            ...user,
            isOnline: presence[user.id]?.isOnline,
        } : user);
    }
    static async createUser(data, db) {
        const email = data.email.trim().toLowerCase();
        const username = typeof data.username === 'string' ? data.username.trim() : undefined;
        const existing = await users_repository_1.UsersRepository.findByEmail(email, db);
        if (existing) {
            throw new error_handler_1.AppError('Email already exists', 409);
        }
        if (!data.password || data.password.length < 8) {
            throw new error_handler_1.AppError('Password must be at least 8 characters', 400);
        }
        const hashedPassword = await bcrypt_1.default.hash(data.password, 10);
        const user = await users_repository_1.UsersRepository.createUser({
            email,
            password: hashedPassword,
            username: username || null,
            firstName: data.firstName?.trim() ?? null,
            lastName: data.lastName?.trim() ?? null,
            role: (data.role ?? 'STUDENT').toUpperCase(),
        }, db);
        return UsersService.withDisplayName(user);
    }
    static async updateUser(id, data, db) {
        const payload = {};
        if (data.email)
            payload.email = data.email.trim().toLowerCase();
        if (data.username !== undefined)
            payload.username = data.username?.trim() ?? null;
        if (data.firstName !== undefined)
            payload.firstName = data.firstName?.trim() ?? null;
        if (data.lastName !== undefined)
            payload.lastName = data.lastName?.trim() ?? null;
        if (data.role)
            payload.role = data.role.toUpperCase();
        if (data.password) {
            payload.password = await bcrypt_1.default.hash(data.password, 10);
        }
        const user = await users_repository_1.UsersRepository.updateUser(id, payload, db);
        return UsersService.withDisplayName(user);
    }
    static async deleteUser(id, db) {
        return users_repository_1.UsersRepository.deleteUser(id, db);
    }
}
exports.UsersService = UsersService;
