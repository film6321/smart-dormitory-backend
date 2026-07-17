"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MaintenanceRepository = void 0;
const db_1 = require("../../database/db");
class MaintenanceRepository {
    static async getTicketById(id, db = db_1.prisma) {
        return db.maintenanceTicket.findUnique({ where: { id } });
    }
    static async createTicket(data, db = db_1.prisma) {
        return db.maintenanceTicket.create({ data });
    }
    static async listTickets(userId, role, db = db_1.prisma) {
        const where = role === 'ADMIN'
            ? {}
            : { tenant: { userId } };
        return db.maintenanceTicket.findMany({
            where,
            include: { tenant: true, room: true },
            orderBy: { createdAt: 'desc' },
        });
    }
    static async updateTicketStatus(id, data, db = db_1.prisma) {
        return db.maintenanceTicket.update({ where: { id }, data });
    }
}
exports.MaintenanceRepository = MaintenanceRepository;
