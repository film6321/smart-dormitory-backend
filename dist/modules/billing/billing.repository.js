"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingRepository = void 0;
const error_handler_1 = require("../../middlewares/error-handler");
const db_1 = require("../../database/db");
class BillingRepository {
    static async listBills(userId, role, db = db_1.prisma) {
        const where = role === 'ADMIN'
            ? {}
            : { tenant: { userId } };
        return db.bill.findMany({
            where,
            include: {
                tenant: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                email: true,
                                role: true,
                            },
                        },
                    },
                },
                room: true,
            },
            orderBy: { createdAt: 'desc' },
        });
    }
    static async findBillById(id, db = db_1.prisma) {
        return db.bill.findUnique({
            where: { id },
            include: {
                tenant: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                email: true,
                                role: true,
                            }
                        }
                    },
                },
                room: true,
            },
        });
    }
    static async findRoomByNumberWithTenants(roomNumber, db = db_1.prisma) {
        return db.room.findUnique({
            where: { roomNumber: roomNumber.trim().toUpperCase() },
            include: {
                tenants: {
                    where: { isActive: true },
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                email: true,
                                role: true,
                            },
                        },
                    },
                },
            },
        });
    }
    static async createBills(bills, db = db_1.prisma) {
        return db.$transaction(bills.map((bill) => db.bill.create({
            data: {
                tenantId: bill.tenantId,
                roomId: bill.roomId,
                amount: bill.amount,
                rentAmount: bill.rentAmount ?? 0,
                electricAmount: bill.electricAmount ?? 0,
                waterAmount: bill.waterAmount ?? 0,
                penaltyAmount: bill.penaltyAmount ?? 0,
                dueDate: bill.dueDate,
                description: bill.description,
                status: 'UNPAID',
            },
            include: {
                tenant: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                email: true,
                                role: true,
                            }
                        }
                    },
                },
                room: true,
            },
        })));
    }
    static async updateBill(id, data, db = db_1.prisma) {
        return db.bill.update({
            where: { id },
            data,
            include: {
                tenant: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                email: true,
                                role: true,
                            }
                        }
                    },
                },
                room: true,
            },
        });
    }
    static async deleteBill(id, db = db_1.prisma) {
        return db.$transaction(async (transaction) => {
            await transaction.$queryRaw `SELECT id FROM "Bill" WHERE id = ${id} FOR UPDATE`;
            const bill = await transaction.bill.findUnique({ where: { id }, include: { _count: true } });
            if (!bill)
                throw new error_handler_1.AppError('ไม่พบบิลที่ต้องการลบ', 404);
            if (bill.status === 'PAID' || bill.status === 'VERIFYING' || Object.values(bill._count).some((count) => count > 0)) {
                throw new error_handler_1.AppError('ลบบิลไม่ได้ เนื่องจากมีประวัติหรือรายการชำระเงินที่ต้องเก็บรักษา', 409);
            }
            return transaction.bill.delete({ where: { id } });
        });
    }
}
exports.BillingRepository = BillingRepository;
