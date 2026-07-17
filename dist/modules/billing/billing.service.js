"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingService = void 0;
const error_handler_1 = require("../../middlewares/error-handler");
const notification_service_1 = __importDefault(require("../notifications/notification.service"));
const billing_repository_1 = require("./billing.repository");
class BillingService {
    static async listBills(userId, role) {
        return billing_repository_1.BillingRepository.listBills(userId, role);
    }
    static async getBillById(id) {
        return billing_repository_1.BillingRepository.findBillById(id);
    }
    static async uploadSlip(billId, slipHash) {
        const bill = await billing_repository_1.BillingRepository.findBillById(billId);
        if (!bill) {
            throw new error_handler_1.AppError('Bill not found', 404);
        }
        return billing_repository_1.BillingRepository.updateBill(billId, {
            status: 'VERIFYING',
            slipHash,
            reason: 'OCR pending',
            version: bill.version + 1,
        });
    }
    static async updateBillStatus(billId, status, reason) {
        const updated = await billing_repository_1.BillingRepository.updateBill(billId, {
            status: status,
            reason,
            version: { increment: 1 },
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
