"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationController = void 0;
const api_response_1 = require("../../shared/api-response");
const notification_service_1 = __importDefault(require("./notification.service"));
class NotificationController {
    static service;
    static getService() {
        if (!NotificationController.service) {
            NotificationController.service = new notification_service_1.default();
        }
        return NotificationController.service;
    }
    static async listNotifications(req, res, next) {
        try {
            const userId = req.user?.id;
            const notifications = await NotificationController.getService().listNotifications(userId);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Notifications fetched successfully', notifications));
        }
        catch (error) {
            next(error);
        }
    }
    static async createNotification(req, res, next) {
        try {
            const notification = await NotificationController.getService().scheduleNotification(req.body);
            return res.status(201).json((0, api_response_1.createResponse)(201, 'Notification scheduled successfully', notification));
        }
        catch (error) {
            next(error);
        }
    }
    static async sendNotification(req, res, next) {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid notification id'));
            }
            const result = await NotificationController.getService().sendNotification(id);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Notification sent successfully', result));
        }
        catch (error) {
            next(error);
        }
    }
    static async handleProviderWebhook(req, res, next) {
        try {
            const result = await NotificationController.getService().handleProviderWebhook(req.body ?? {});
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Webhook processed', result));
        }
        catch (error) {
            next(error);
        }
    }
    static async listDeadLetters(req, res, next) {
        try {
            const deadLetters = await NotificationController.getService().listDeadLetters();
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Dead letters fetched successfully', deadLetters));
        }
        catch (error) {
            next(error);
        }
    }
    static async listAuditLogs(req, res, next) {
        try {
            const notificationId = req.query.notificationId ? Number(req.query.notificationId) : undefined;
            const auditLogs = await NotificationController.getService().listAuditLogs(notificationId);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Audit logs fetched successfully', auditLogs));
        }
        catch (error) {
            next(error);
        }
    }
    static async retryDeadLetter(req, res, next) {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid dead letter id'));
            }
            const result = await NotificationController.getService().retryDeadLetter(id);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Dead letter retried successfully', result));
        }
        catch (error) {
            next(error);
        }
    }
    static async deleteDeadLetter(req, res, next) {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid dead letter id'));
            }
            const result = await NotificationController.getService().deleteDeadLetter(id);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Dead letter deleted successfully', result));
        }
        catch (error) {
            next(error);
        }
    }
}
exports.NotificationController = NotificationController;
exports.default = NotificationController;
