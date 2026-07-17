"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingRepository = void 0;
const db_1 = require("../../database/db");
class BillingRepository {
    static async listBills(userId, role, db = db_1.prisma) {
        const where = role === 'ADMIN'
            ? {}
            : { tenant: { userId } };
        return db.bill.findMany({
            where,
            include: {
                tenant: true,
                room: true,
            },
            orderBy: { dueDate: 'asc' },
        });
    }
    static async findBillById(id, db = db_1.prisma) {
        return db.bill.findUnique({ where: { id } });
    }
    static async updateBill(id, data, db = db_1.prisma) {
        return db.bill.update({ where: { id }, data });
    }
}
exports.BillingRepository = BillingRepository;
