"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantsRepository = void 0;
const db_1 = require("../../database/db");
class TenantsRepository {
    static async listTenants(userId, role, db = db_1.prisma) {
        const where = role === 'ADMIN' ? {} : { userId };
        return db.tenant.findMany({
            where,
            include: { user: true, room: true },
            orderBy: { createdAt: 'desc' },
        });
    }
    static async getTenantById(id, db = db_1.prisma) {
        return db.tenant.findUnique({
            where: { id },
            include: { user: true, room: true },
        });
    }
    static async findUserById(id, db = db_1.prisma) {
        return db.user.findUnique({ where: { id } });
    }
    static async findRoomById(id, db = db_1.prisma) {
        return db.room.findUnique({ where: { id } });
    }
    static async createTenant(data, db = db_1.prisma) {
        return db.tenant.create({ data });
    }
    static async updateTenant(id, data, db = db_1.prisma) {
        return db.tenant.update({ where: { id }, data });
    }
    static async deleteTenant(id, db = db_1.prisma) {
        return db.tenant.delete({ where: { id } });
    }
}
exports.TenantsRepository = TenantsRepository;
