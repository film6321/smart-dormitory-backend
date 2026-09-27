"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersRepository = void 0;
const error_handler_1 = require("../../middlewares/error-handler");
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
        const remove = async (transaction) => {
            await transaction.$queryRaw `SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
            const record = await transaction.user.findUnique({ where: { id }, include: { _count: true } });
            if (!record)
                throw new error_handler_1.AppError('ไม่พบผู้ใช้ที่ต้องการลบ', 404);
            if (Object.values(record._count).some((count) => count > 0)) {
                throw new error_handler_1.AppError('ลบผู้ใช้ไม่ได้ เนื่องจากมีข้อมูลหรือประวัติที่เกี่ยวข้องอยู่', 409);
            }
            return transaction.user.delete({ where: { id } });
        };
        return typeof db.$transaction === 'function'
            ? db.$transaction(remove) : remove(db);
    }
}
exports.UsersRepository = UsersRepository;
