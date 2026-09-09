"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsController = void 0;
const api_response_1 = require("../../shared/api-response");
const settings_service_1 = require("./settings.service");
class SettingsController {
    static async get(req, res, next) {
        try {
            const data = await settings_service_1.SettingsService.get();
            return res.status(200).json((0, api_response_1.createResponse)(200, 'System settings fetched successfully', data));
        }
        catch (error) {
            next(error);
        }
    }
    static async update(req, res, next) {
        try {
            const userId = req.user.id;
            const data = await settings_service_1.SettingsService.update(req.body, userId);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'System settings updated successfully', data));
        }
        catch (error) {
            next(error);
        }
    }
}
exports.SettingsController = SettingsController;
