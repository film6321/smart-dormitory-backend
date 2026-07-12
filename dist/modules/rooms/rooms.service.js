"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomsService = void 0;
const db_1 = require("../../database/db");
const error_handler_1 = require("../../middlewares/error-handler");
class RoomsService {
    static async listRooms(prismaClient = db_1.prisma) {
        return prismaClient.room.findMany({
            include: { tenant: true, bills: true },
            orderBy: { roomNumber: 'asc' },
        });
    }
    static async getRoomById(id, prismaClient = db_1.prisma) {
        return prismaClient.room.findUnique({
            where: { id },
            include: { tenant: true, bills: true },
        });
    }
    static async createRoom(data, prismaClient = db_1.prisma) {
        const roomNumber = data.roomNumber.trim().toUpperCase();
        const existing = await prismaClient.room.findUnique({ where: { roomNumber } });
        if (existing) {
            throw new error_handler_1.AppError('Room number already exists', 409);
        }
        return prismaClient.room.create({
            data: {
                roomNumber,
                floor: data.floor ?? null,
                status: data.status ?? 'AVAILABLE',
                capacity: data.capacity ?? 1,
                monthlyRent: Number(data.monthlyRent),
                description: data.description?.trim() ?? null,
            },
        });
    }
    static async updateRoom(id, data, prismaClient = db_1.prisma) {
        const payload = {};
        if (data.roomNumber) {
            payload.roomNumber = data.roomNumber.trim().toUpperCase();
        }
        if (data.floor !== undefined)
            payload.floor = data.floor ?? null;
        if (data.status)
            payload.status = data.status;
        if (data.capacity !== undefined)
            payload.capacity = data.capacity;
        if (data.monthlyRent !== undefined)
            payload.monthlyRent = Number(data.monthlyRent);
        if (data.description !== undefined)
            payload.description = data.description?.trim() ?? null;
        return prismaClient.room.update({ where: { id }, data: payload });
    }
    static async deleteRoom(id, prismaClient = db_1.prisma) {
        return prismaClient.room.delete({ where: { id } });
    }
}
exports.RoomsService = RoomsService;
