"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisitorService = void 0;
const db_1 = require("../../database/db");
class VisitorService {
    static async getVisitorById(id) {
        return db_1.prisma.visitor.findUnique({ where: { id } });
    }
    static async registerVisitor(data) {
        return db_1.prisma.visitor.create({
            data: {
                guestName: data.guestName,
                purpose: data.purpose,
                roomId: data.roomId,
                tenantId: data.tenantId,
                expectedEntryTime: data.expectedEntryTime,
                status: 'REGISTERED',
            },
        });
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
