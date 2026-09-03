"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthRepository = void 0;
const db_1 = require("../../database/db");
class AuthRepository {
    static async findByEmail(email, db = db_1.prisma) {
        const client = db;
        return db.user.findUnique({
            where: { email },
            select: {
                id: true,
                email: true,
                username: true,
                password: true,
                role: true,
                firstName: true,
                lastName: true,
                lastLogin: true,
            },
        });
    }
    static async findByUsername(username, db = db_1.prisma) {
        const client = db;
        return client.user.findUnique({
            where: { username },
            select: {
                id: true,
                username: true,
            },
        });
    }
    static async createUser(data, db = db_1.prisma) {
        const client = db;
        return client.user.create({
            data: data,
            select: { id: true, email: true, username: true, role: true, firstName: true, lastName: true, lastLogin: true, password: true },
        });
    }
    static async updateUser(id, data, db = db_1.prisma) {
        const client = db;
        return client.user.update({ where: { id }, data: data });
    }
}
exports.AuthRepository = AuthRepository;
