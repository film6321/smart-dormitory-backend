"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingService = void 0;
const db_1 = require("../../database/db");
const error_handler_1 = require("../../middlewares/error-handler");
const notification_service_1 = __importDefault(require("../notifications/notification.service"));
class BillingService {
    static async listBills(userId, role) {
        const where = role === 'ADMIN'
            ? {}
            : { tenant: { userId } };
        return db_1.prisma.bill.findMany({
            where,
            include: {
                tenant: true,
                room: true,
            },
            orderBy: { dueDate: 'asc' },
        });
    }
    static async getBillById(id) {
        return db_1.prisma.bill.findUnique({ where: { id } });
    }
    static async uploadSlip(billId, slipHash) {
        const bill = await db_1.prisma.bill.findUnique({ where: { id: billId } });
        if (!bill) {
            throw new error_handler_1.AppError('Bill not found', 404);
        }
        return db_1.prisma.bill.update({
            where: { id: billId },
            data: {
                status: 'VERIFYING',
                slipHash,
                reason: 'OCR pending',
                version: bill.version + 1,
            },
        });
    }
    static async updateBillStatus(billId, status, reason) {
        const updated = await db_1.prisma.bill.update({
            where: { id: billId },
            data: {
                status: status,
                reason,
                version: { increment: 1 },
            },
        });
        if (status === 'OVERDUE') {
            const notificationService = new notification_service_1.default();
            await notificationService.scheduleNotification({
                tenantId: updated.tenantId,
                channel: 'SMS',
                type: 'RENT_OVERDUE',
                payload: JSON.stringify({ message: `Bill ${updated.id} is overdue`, amount: updated.amount.toString() }),
            });
        }
        return updated;
    }
}
exports.BillingService = BillingService;
