"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationPreferenceController = void 0;
const api_response_1 = require("../../shared/api-response");
const notification_service_1 = __importDefault(require("./notification.service"));
class NotificationPreferenceController {
    static service = new notification_service_1.default();
    async getPreferences(userId) {
        return NotificationPreferenceController.service.listPreferences(userId);
    }
    static async listPreferences(req, res, next) {
        try {
            const userId = req.user?.id;
            const preferences = await new NotificationPreferenceController().getPreferences(userId);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Notification preferences fetched successfully', preferences));
        }
        catch (error) {
            next(error);
        }
    }
    static async upsertPreference(req, res, next) {
        try {
            const userId = req.user?.id;
            const { channel, type, optedOut } = req.body;
            const preference = await NotificationPreferenceController.service.upsertPreference({ userId, channel, type, optedOut });
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Notification preference updated successfully', preference));
        }
        catch (error) {
            next(error);
        }
    }
}
exports.NotificationPreferenceController = NotificationPreferenceController;
exports.default = NotificationPreferenceController;
