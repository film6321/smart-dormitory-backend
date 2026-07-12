"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersController = void 0;
const api_response_1 = require("../../shared/api-response");
const users_service_1 = require("./users.service");
class UsersController {
    static async listUsers(req, res, next) {
        try {
            const users = await users_service_1.UsersService.listUsers();
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Users fetched successfully', users));
        }
        catch (error) {
            next(error);
        }
    }
    static async getUserById(req, res, next) {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid user id'));
            }
            const user = await users_service_1.UsersService.getUserById(id);
            if (!user) {
                return res.status(404).json((0, api_response_1.createResponse)(404, 'User not found'));
            }
            return res.status(200).json((0, api_response_1.createResponse)(200, 'User fetched successfully', user));
        }
        catch (error) {
            next(error);
        }
    }
    static async createUser(req, res, next) {
        try {
            const user = await users_service_1.UsersService.createUser(req.body);
            return res.status(201).json((0, api_response_1.createResponse)(201, 'User created successfully', user));
        }
        catch (error) {
            next(error);
        }
    }
    static async updateUser(req, res, next) {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid user id'));
            }
            const user = await users_service_1.UsersService.updateUser(id, req.body);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'User updated successfully', user));
        }
        catch (error) {
            next(error);
        }
    }
    static async deleteUser(req, res, next) {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid user id'));
            }
            await users_service_1.UsersService.deleteUser(id);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'User deleted successfully'));
        }
        catch (error) {
            next(error);
        }
    }
}
exports.UsersController = UsersController;
