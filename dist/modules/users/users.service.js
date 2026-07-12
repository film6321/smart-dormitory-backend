"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const db_1 = require("../../database/db");
const error_handler_1 = require("../../middlewares/error-handler");
class UsersService {
    static async listUsers(prismaClient = db_1.prisma) {
        return prismaClient.user.findMany({
            select: {
                id: true,
                email: true,
                role: true,
                firstName: true,
                lastName: true,
                createdAt: true,
                updatedAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });
    }
    static async getUserById(id, prismaClient = db_1.prisma) {
        return prismaClient.user.findUnique({
            where: { id },
            select: {
                id: true,
                email: true,
                role: true,
                firstName: true,
                lastName: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    }
    static async createUser(data, prismaClient = db_1.prisma) {
        const email = data.email.trim().toLowerCase();
        const existing = await prismaClient.user.findUnique({ where: { email } });
        if (existing) {
            throw new error_handler_1.AppError('Email already exists', 409);
        }
        if (!data.password || data.password.length < 8) {
            throw new error_handler_1.AppError('Password must be at least 8 characters', 400);
        }
        const hashedPassword = await bcrypt_1.default.hash(data.password, 10);
        return prismaClient.user.create({
            data: {
                email,
                password: hashedPassword,
                firstName: data.firstName?.trim() ?? null,
                lastName: data.lastName?.trim() ?? null,
                role: (data.role ?? 'STUDENT').toUpperCase(),
            },
            select: {
                id: true,
                email: true,
                role: true,
                firstName: true,
                lastName: true,
                password: true,
            },
        });
    }
    static async updateUser(id, data, prismaClient = db_1.prisma) {
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
        return prismaClient.user.update({ where: { id }, data: payload });
    }
    static async deleteUser(id, prismaClient = db_1.prisma) {
        return prismaClient.user.delete({ where: { id } });
    }
}
exports.UsersService = UsersService;
