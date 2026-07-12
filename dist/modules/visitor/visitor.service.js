"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisitorService = void 0;
const db_1 = require("../../database/db");
const notification_service_1 = __importDefault(require("../notifications/notification.service"));
class VisitorService {
    static async getVisitorById(id) {
        return db_1.prisma.visitor.findUnique({ where: { id } });
    }
    static async registerVisitor(data) {
        const visitor = await db_1.prisma.visitor.create({
            data: {
                guestName: data.guestName,
                purpose: data.purpose,
                roomId: data.roomId,
                tenantId: data.tenantId,
                expectedEntryTime: data.expectedEntryTime,
                status: 'REGISTERED',
            },
        });
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
        return db_1.prisma.visitor.findMany({
            include: { logs: true },
            orderBy: { createdAt: 'desc' },
        });
    }
    static async updateVisitorStatus(id, status) {
        return db_1.prisma.visitor.update({
            where: { id },
            data: {
                status: status,
            },
        });
    }
}
exports.VisitorService = VisitorService;
