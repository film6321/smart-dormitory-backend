"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisitorRepository = void 0;
const db_1 = require("../../database/db");
class VisitorRepository {
    static async getVisitorById(id, db = db_1.prisma) {
        return db.visitor.findUnique({
            where: { id },
            include: {
                logs: { orderBy: { createdAt: 'asc' } },
                room: { select: { roomNumber: true } },
                tenant: { select: { fullName: true, studentId: true } },
            },
        });
    }
    static async registerVisitor(data, db = db_1.prisma) {
        return db.visitor.create({ data });
    }
    static async listVisitors(db = db_1.prisma) {
        return db.visitor.findMany({
            include: {
                logs: { orderBy: { createdAt: 'asc' } },
                room: { select: { roomNumber: true } },
                tenant: { select: { fullName: true, studentId: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
    }
    static async updateVisitorStatus(id, data, db = db_1.prisma) {
        return db.visitor.update({ where: { id }, data });
    }
}
exports.VisitorRepository = VisitorRepository;
