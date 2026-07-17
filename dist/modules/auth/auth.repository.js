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
                password: true,
                role: true,
                firstName: true,
                lastName: true,
            },
        });
    }
    static async createUser(data, db = db_1.prisma) {
        const client = db;
        return client.user.create({ data: data, select: { id: true, email: true, role: true, firstName: true, lastName: true, password: true } });
    }
    static async updateUser(id, data, db = db_1.prisma) {
        const client = db;
        return client.user.update({ where: { id }, data: data });
    }
}
exports.AuthRepository = AuthRepository;
