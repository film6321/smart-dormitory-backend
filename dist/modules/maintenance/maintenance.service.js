"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MaintenanceService = void 0;
const db_1 = require("../../database/db");
const notification_service_1 = __importDefault(require("../notifications/notification.service"));
class MaintenanceService {
    static async getTicketById(id) {
        return db_1.prisma.maintenanceTicket.findUnique({ where: { id } });
    }
    static async createTicket(data) {
        const ticket = await db_1.prisma.maintenanceTicket.create({
            data: {
                tenantId: data.tenantId,
                roomId: data.roomId,
                category: data.category,
                description: data.description,
                contactTime: data.contactTime,
            },
        });
        const notificationService = new notification_service_1.default();
        await notificationService.scheduleNotification({
            tenantId: ticket.tenantId,
            channel: 'SMS',
            type: 'MAINTENANCE_COMPLETED',
            payload: JSON.stringify({ message: `Maintenance ticket ${ticket.id} created`, category: ticket.category }),
        });
        return ticket;
    }
    static async listTickets(userId, role) {
        const where = role === 'ADMIN'
            ? {}
            : { tenant: { userId } };
        return db_1.prisma.maintenanceTicket.findMany({
            where,
            include: { tenant: true, room: true },
            orderBy: { createdAt: 'desc' },
        });
    }
    static async updateTicketStatus(id, status, note) {
        return db_1.prisma.maintenanceTicket.update({
            where: { id },
            data: {
                status: status,
                note,
            },
        });
    }
}
exports.MaintenanceService = MaintenanceService;
