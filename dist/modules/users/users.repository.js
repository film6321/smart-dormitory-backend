"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersRepository = void 0;
const db_1 = require("../../database/db");
class UsersRepository {
    static baseUserSelect = {
        id: true,
        email: true,
        lastLogin: true,
        createdAt: true,
        updatedAt: true,
    };
    static usernameUserSelect = {
        ...UsersRepository.baseUserSelect,
        username: true,
    };
    static async listUsers(db = db_1.prisma) {
        try {
            return await db.user.findMany({
                select: UsersRepository.usernameUserSelect,
                orderBy: { createdAt: 'desc' },
            });
        }
        catch (error) {
            if (error?.code !== 'P2022') {
                throw error;
            }
            return db.user.findMany({
                select: UsersRepository.baseUserSelect,
                orderBy: { createdAt: 'desc' },
            });
        }
    }
    static async getUserById(id, db = db_1.prisma) {
        try {
            return await db.user.findUnique({
                where: { id },
                select: UsersRepository.usernameUserSelect,
            });
        }
        catch (error) {
            if (error?.code !== 'P2022') {
                throw error;
            }
            return db.user.findUnique({
                where: { id },
                select: UsersRepository.baseUserSelect,
            });
        }
    }
    static async findByEmail(email, db = db_1.prisma) {
        return db.user.findUnique({
            where: { email },
            select: {
                ...UsersRepository.baseUserSelect,
            },
        });
    }
    static async createUser(data, db = db_1.prisma) {
        try {
            return await db.user.create({
                data: data,
                select: {
                    id: true,
                    email: true,
                    role: true,
                },
            });
        }
        catch (error) {
            if (error?.code !== 'P2022') {
                throw error;
            }
            const fallbackData = { ...data };
            delete fallbackData.username;
            return db.user.create({
                data: fallbackData,
                select: {
                    id: true,
                    email: true,
                    role: true,
                },
            });
        }
    }
    static async updateUser(id, data, db = db_1.prisma) {
        return db.user.update({ where: { id }, data: data });
    }
    static async deleteUser(id, db = db_1.prisma) {
        return db.user.delete({ where: { id } });
    }
}
exports.UsersRepository = UsersRepository;
