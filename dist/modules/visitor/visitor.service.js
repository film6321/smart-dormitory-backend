"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisitorService = void 0;
const notification_service_1 = __importDefault(require("../notifications/notification.service"));
const visitor_repository_1 = require("./visitor.repository");
class VisitorService {
    static async getVisitorById(id) {
        return visitor_repository_1.VisitorRepository.getVisitorById(id);
    }
    static async registerVisitor(data) {
        const createData = {
            guestName: data.guestName,
            purpose: data.purpose,
            expectedEntryTime: data.expectedEntryTime,
            status: 'REGISTERED',
        };
        if (data.roomId !== undefined && data.roomId !== null)
            createData.room = { connect: { id: data.roomId } };
        if (data.tenantId !== undefined && data.tenantId !== null)
            createData.tenant = { connect: { id: data.tenantId } };
        const visitor = await visitor_repository_1.VisitorRepository.registerVisitor(createData);
        const notificationService = new notification_service_1.default();
        await notificationService.scheduleNotification({
            tenantId: visitor.tenantId ?? undefined,
            channel: 'SMS',
            type: 'VISITOR_ARRIVAL',
            payload: JSON.stringify({ message: `Visitor ${visitor.guestName} registered`, visitorId: visitor.id }),
        });
        return visitor;
    }
    static async listVisitors() {
        return visitor_repository_1.VisitorRepository.listVisitors();
    }
    static async updateVisitorStatus(id, status) {
        return visitor_repository_1.VisitorRepository.updateVisitorStatus(id, {
            status: status,
        });
    }
}
exports.VisitorService = VisitorService;
