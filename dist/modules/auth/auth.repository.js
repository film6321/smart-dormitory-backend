"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthRepository = void 0;
const db_1 = require("../../database/db");
class AuthRepository {
    static async findByEmail(email, db = db_1.prisma) {
        return db.user.findUnique({
            where: { email },
            select: {
                id: true,
                email: true,
                username: true,
                role: true,
                createdAt: true,
                lastLogin: true,
                updatedAt: true,
                password: true,
            },
        });
    }
    static async findByUsername(username, db = db_1.prisma) {
        return db.user.findUnique({
            where: { username },
            select: {
                id: true,
                username: true,
            },
        });
    }
    static async createUser(data, db = db_1.prisma) {
        return db.user.create({
            data: data,
            select: {
                id: true,
                email: true,
                username: true,
                role: true,
                lastLogin: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    }
    static async updateUser(id, data, db = db_1.prisma) {
        return db.user.update({ where: { id }, data: data });
    }
}
exports.AuthRepository = AuthRepository;
