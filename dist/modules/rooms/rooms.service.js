"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomsService = void 0;
const error_handler_1 = require("../../middlewares/error-handler");
const rooms_repository_1 = require("./rooms.repository");
class RoomsService {
    static async listRooms() {
        return rooms_repository_1.RoomsRepository.listRooms();
    }
    static async getRoomById(id) {
        return rooms_repository_1.RoomsRepository.getRoomById(id);
    }
    static async createRoom(data, db) {
        const roomNumber = data.roomNumber.trim().toUpperCase();
        const existing = await rooms_repository_1.RoomsRepository.findByNumber(roomNumber, db);
        if (existing) {
            throw new error_handler_1.AppError('Room number already exists', 409);
        }
        return rooms_repository_1.RoomsRepository.createRoom({
            roomNumber,
            floor: data.floor ?? null,
            status: data.status ?? 'AVAILABLE',
            capacity: data.capacity ?? 1,
            monthlyRent: Number(data.monthlyRent),
            description: data.description?.trim() ?? null,
        }, db);
    }
    static async updateRoom(id, data) {
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
        return rooms_repository_1.RoomsRepository.updateRoom(id, payload);
    }
    static async deleteRoom(id) {
        return rooms_repository_1.RoomsRepository.deleteRoom(id);
    }
}
exports.RoomsService = RoomsService;
