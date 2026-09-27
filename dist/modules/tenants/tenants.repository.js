"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantsRepository = void 0;
const error_handler_1 = require("../../middlewares/error-handler");
const db_1 = require("../../database/db");
class TenantsRepository {
    static userSelect = {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
    };
    static async listTenants(userId, role, db = db_1.prisma) {
        const where = role === 'ADMIN' ? {} : { userId };
        return db.tenant.findMany({
            where,
            include: { user: { select: TenantsRepository.userSelect }, room: true },
            orderBy: { createdAt: 'desc' },
        });
    }
    static async getTenantById(id, db = db_1.prisma) {
        return db.tenant.findUnique({
            where: { id },
            include: { user: { select: TenantsRepository.userSelect }, room: true },
        });
    }
    static async getTenantByUserId(userId, db = db_1.prisma) {
        return db.tenant.findUnique({
            where: { userId },
            include: { user: { select: TenantsRepository.userSelect }, room: true },
        });
    }
    static async findUserById(id, db = db_1.prisma) {
        return db.user.findUnique({
            where: { id },
            select: { id: true },
        });
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
        const deleteRelatedRecords = async (transaction) => {
            await transaction.$queryRaw `SELECT id FROM "Tenant" WHERE id = ${id} FOR UPDATE`;
            const tenant = await transaction.tenant.findUnique({ where: { id }, include: { _count: true } });
            if (!tenant)
                throw new error_handler_1.AppError('ไม่พบผู้พักที่ต้องการลบ', 404);
            if (Object.values(tenant._count).some((count) => count > 0)) {
                throw new error_handler_1.AppError('ลบผู้พักไม่ได้ เนื่องจากมีประวัติชำระเงิน บิล ผู้มาติดต่อ หรือแจ้งซ่อมที่ต้องเก็บรักษา', 409);
            }
            if (tenant.roomId) {
                await transaction.$queryRaw `SELECT id FROM "Room" WHERE id = ${tenant.roomId} FOR UPDATE`;
                const remaining = await transaction.tenant.count({ where: { roomId: tenant.roomId, id: { not: id } } });
                if (remaining === 0)
                    await transaction.room.updateMany({
                        where: { id: tenant.roomId, status: 'OCCUPIED' }, data: { status: 'AVAILABLE' },
                    });
            }
            return transaction.tenant.delete({ where: { id } });
        };
        if (typeof db.$transaction === 'function') {
            return db.$transaction((transaction) => deleteRelatedRecords(transaction));
        }
        return deleteRelatedRecords(db);
    }
}
exports.TenantsRepository = TenantsRepository;
