"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomsController = void 0;
const api_response_1 = require("../../shared/api-response");
const rooms_service_1 = require("./rooms.service");
class RoomsController {
    static async listRooms(req, res, next) {
        try {
            const rooms = await rooms_service_1.RoomsService.listRooms();
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Rooms fetched successfully', rooms));
        }
        catch (error) {
            next(error);
        }
    }
    static async getRoomById(req, res, next) {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid room id'));
            }
            const room = await rooms_service_1.RoomsService.getRoomById(id);
            if (!room) {
                return res.status(404).json((0, api_response_1.createResponse)(404, 'Room not found'));
            }
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Room fetched successfully', room));
        }
        catch (error) {
            next(error);
        }
    }
    static async createRoom(req, res, next) {
        try {
            const room = await rooms_service_1.RoomsService.createRoom(req.body);
            return res.status(201).json((0, api_response_1.createResponse)(201, 'Room created successfully', room));
        }
        catch (error) {
            next(error);
        }
    }
    static async updateRoom(req, res, next) {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid room id'));
            }
            const room = await rooms_service_1.RoomsService.updateRoom(id, req.body);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Room updated successfully', room));
        }
        catch (error) {
            next(error);
        }
    }
    static async deleteRoom(req, res, next) {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid room id'));
            }
            await rooms_service_1.RoomsService.deleteRoom(id);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Room deleted successfully'));
        }
        catch (error) {
            next(error);
        }
    }
}
exports.RoomsController = RoomsController;
