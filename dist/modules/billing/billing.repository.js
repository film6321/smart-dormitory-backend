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
            await transaction.paymentBatchItem.deleteMany({ where: { billId: id } });
            await transaction.payment.deleteMany({ where: { billId: id } });
            return transaction.bill.delete({ where: { id } });
        });
    }
}
exports.BillingRepository = BillingRepository;
