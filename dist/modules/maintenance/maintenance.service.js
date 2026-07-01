"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MaintenanceService = void 0;
const db_1 = require("../../database/db");
class MaintenanceService {
    static async getTicketById(id) {
        return db_1.prisma.maintenanceTicket.findUnique({ where: { id } });
    }
    static async createTicket(data) {
        return db_1.prisma.maintenanceTicket.create({
            data: {
                tenantId: data.tenantId,
                roomId: data.roomId,
                category: data.category,
                description: data.description,
                contactTime: data.contactTime,
            },
        });
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
