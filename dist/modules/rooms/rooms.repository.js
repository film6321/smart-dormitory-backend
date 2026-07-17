"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomsRepository = void 0;
const db_1 = require("../../database/db");
class RoomsRepository {
    static async listRooms(db = db_1.prisma) {
        return db.room.findMany({
            include: { tenant: true, bills: true },
            orderBy: { roomNumber: 'asc' },
        });
    }
    static async getRoomById(id, db = db_1.prisma) {
        return db.room.findUnique({
            where: { id },
            include: { tenant: true, bills: true },
        });
    }
    static async findByNumber(roomNumber, db = db_1.prisma) {
        return db.room.findUnique({ where: { roomNumber } });
    }
    static async createRoom(data, db = db_1.prisma) {
        return db.room.create({ data });
    }
    static async updateRoom(id, data, db = db_1.prisma) {
        return db.room.update({ where: { id }, data });
    }
    static async deleteRoom(id, db = db_1.prisma) {
        return db.room.delete({ where: { id } });
    }
}
exports.RoomsRepository = RoomsRepository;
