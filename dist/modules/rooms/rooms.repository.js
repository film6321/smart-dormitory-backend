"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomsRepository = void 0;
const error_handler_1 = require("../../middlewares/error-handler");
const db_1 = require("../../database/db");
class RoomsRepository {
    static tenantSelect = {
        id: true,
        userId: true,
        fullName: true,
        phone: true,
        email: true,
        studentId: true,
        status: true,
        checkInDate: true,
        isActive: true,
        user: {
            select: {
                id: true,
                username: true,
                email: true,
            },
        },
    };
    static async listRooms(db = db_1.prisma) {
        return db.room.findMany({
            include: {
                tenants: {
                    select: RoomsRepository.tenantSelect,
                },
            },
            orderBy: { roomNumber: 'asc' },
        });
    }
    static async getRoomById(id, db = db_1.prisma) {
        return db.room.findUnique({
            where: { id },
            include: {
                tenants: {
                    select: RoomsRepository.tenantSelect,
                },
            },
        });
    }
    static async findByNumber(roomNumber, db = db_1.prisma) {
        return db.room.findUnique({
            where: { roomNumber },
            include: {
                tenants: {
                    select: RoomsRepository.tenantSelect,
                },
            },
        });
    }
    static async createRoom(data, db = db_1.prisma) {
        return db.room.create({ data });
    }
    static async updateRoom(id, data, db = db_1.prisma) {
        return db.room.update({ where: { id }, data });
    }
    static async deleteRoom(id, db = db_1.prisma) {
        const remove = async (transaction) => {
            await transaction.$queryRaw `SELECT id FROM "Room" WHERE id = ${id} FOR UPDATE`;
            const record = await transaction.room.findUnique({ where: { id }, include: { _count: true } });
            if (!record)
                throw new error_handler_1.AppError('ไม่พบห้องที่ต้องการลบ', 404);
            if (Object.values(record._count).some((count) => count > 0)) {
                throw new error_handler_1.AppError('ลบห้องไม่ได้ เนื่องจากมีข้อมูลหรือประวัติที่เกี่ยวข้องอยู่', 409);
            }
            return transaction.room.delete({ where: { id } });
        };
        return typeof db.$transaction === 'function'
            ? db.$transaction(remove) : remove(db);
    }
}
exports.RoomsRepository = RoomsRepository;
