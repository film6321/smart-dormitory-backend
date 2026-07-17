"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersRepository = void 0;
const db_1 = require("../../database/db");
class UsersRepository {
    static async listUsers(db = db_1.prisma) {
        const client = db;
        return db.user.findMany({
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
    static async getUserById(id, db = db_1.prisma) {
        const client = db;
        return db.user.findUnique({
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
    static async findByEmail(email, db = db_1.prisma) {
        const client = db;
        return db.user.findUnique({
            where: { email },
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
    static async createUser(data, db = db_1.prisma) {
        const client = db;
        return client.user.create({
            data: data,
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
    static async updateUser(id, data, db = db_1.prisma) {
        const client = db;
        return client.user.update({ where: { id }, data: data });
    }
    static async deleteUser(id, db = db_1.prisma) {
        const client = db;
        return client.user.delete({ where: { id } });
    }
}
exports.UsersRepository = UsersRepository;
