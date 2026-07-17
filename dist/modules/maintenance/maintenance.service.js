"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MaintenanceService = void 0;
const notification_service_1 = __importDefault(require("../notifications/notification.service"));
const maintenance_repository_1 = require("./maintenance.repository");
class MaintenanceService {
    static async getTicketById(id) {
        return maintenance_repository_1.MaintenanceRepository.getTicketById(id);
    }
    static async createTicket(data) {
        const ticket = await maintenance_repository_1.MaintenanceRepository.createTicket({
            tenant: { connect: { id: data.tenantId } },
            room: data.roomId ? { connect: { id: data.roomId } } : undefined,
            category: data.category,
            description: data.description,
            contactTime: data.contactTime,
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
        return maintenance_repository_1.MaintenanceRepository.listTickets(userId, role);
    }
    static async updateTicketStatus(id, status, note) {
        return maintenance_repository_1.MaintenanceRepository.updateTicketStatus(id, {
            status: status,
            note,
        });
    }
}
exports.MaintenanceService = MaintenanceService;
