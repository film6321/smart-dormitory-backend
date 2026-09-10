"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingController = void 0;
const api_response_1 = require("../../shared/api-response");
const billing_service_1 = require("./billing.service");
const error_handler_1 = require("../../middlewares/error-handler");
const state_transitions_1 = require("../../shared/state-transitions");
class BillingController {
    static async getBillingReport(req, res, next) {
        try {
            const from = typeof req.query.from === 'string' ? new Date(req.query.from) : undefined;
            const to = typeof req.query.to === 'string' ? new Date(req.query.to) : undefined;
            if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid report date range'));
            }
            const report = await billing_service_1.BillingService.getBillingReport(from, to);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Billing report fetched successfully', report));
        }
        catch (error) {
            next(error);
        }
    }
    static async listBills(req, res, next) {
        try {
            const authReq = req;
            const bills = await billing_service_1.BillingService.listBills(authReq.user?.id, authReq.user?.role);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Bills fetched successfully', bills));
        }
        catch (error) {
            next(error);
        }
    }
    static async getRoomBillingInfo(req, res, next) {
        try {
            const roomNumber = String(req.params.roomNumber);
            const roomInfo = await billing_service_1.BillingService.getRoomBillingInfo(roomNumber);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Room billing info fetched successfully', roomInfo));
        }
        catch (error) {
            next(error);
        }
    }
    static async generatePaymentQr(req, res, next) {
        try {
            const authReq = req;
            const billId = Number(req.params.id);
            if (!Number.isInteger(billId) || billId <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid bill id'));
            }
            const qrCode = await billing_service_1.BillingService.generatePaymentQr(billId, authReq.user.id);
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'private, no-store');
            return res.send(qrCode);
        }
        catch (error) {
            return next(error);
        }
    }
    static async generateRoomBills(req, res, next) {
        try {
            const { roomNumber, electricUnits, electricRate, waterAmount, dueDate, billingMonth, customRent } = req.body;
            const result = await billing_service_1.BillingService.generateRoomBills({
                roomNumber: String(roomNumber),
                electricUnits: Number(electricUnits),
                electricRate: electricRate !== undefined ? Number(electricRate) : undefined,
                waterAmount: waterAmount !== undefined ? Number(waterAmount) : undefined,
                dueDate: dueDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                billingMonth: billingMonth ? String(billingMonth) : undefined,
                customRent: customRent !== undefined ? Number(customRent) : undefined,
            });
            return res.status(201).json((0, api_response_1.createResponse)(201, 'คำนวณและสร้างบิลส่งให้นักศึกษาในห้องสำเร็จ', result));
        }
        catch (error) {
            next(error);
        }
    }
    static async uploadSlip(req, res, next) {
        try {
            const authReq = req;
            const billId = Number(req.params.id);
            if (!Number.isInteger(billId) || billId <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid bill id'));
            }
            const idempotencyKey = req.header('Idempotency-Key')?.trim();
            if (!idempotencyKey) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Idempotency-Key header is required'));
            }
            if (!req.file) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'slipImage file is required'));
            }
            const result = await billing_service_1.BillingService.verifyPaymentSlip(billId, authReq.user.id, idempotencyKey, req.file);
            const safeResult = {
                billStatus: result.billStatus,
                payment: {
                    id: result.payment.id,
                    billId: result.payment.billId,
                    amount: Number(result.payment.amount),
                    status: result.payment.status,
                    provider: result.payment.provider,
                    providerTransactionId: result.payment.providerTransactionId,
                    slipAmount: result.payment.slipAmount === null ? null : Number(result.payment.slipAmount),
                    transferAt: result.payment.transferAt,
                    failureReason: result.payment.failureReason,
                    verifiedAt: result.payment.verifiedAt,
                    createdAt: result.payment.createdAt,
                    updatedAt: result.payment.updatedAt,
                },
            };
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Payment verification completed', safeResult));
        }
        catch (error) {
            next(error);
        }
    }
    static async updateBillStatus(req, res, next) {
        try {
            const billId = Number(req.params.id);
            const { status, reason } = req.body;
            if (!Number.isInteger(billId) || billId <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid bill id'));
            }
            const existingBill = await billing_service_1.BillingService.getBillById(billId);
            if (!existingBill) {
                return res.status(404).json((0, api_response_1.createResponse)(404, 'Bill not found'));
            }
            if (!(0, state_transitions_1.canTransitionBillStatus)(existingBill.status, status)) {
                return next(new error_handler_1.AppError('Invalid bill state transition', 409));
            }
            const updated = await billing_service_1.BillingService.updateBillStatus(billId, status, reason);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Bill status updated', updated));
        }
        catch (error) {
            next(error);
        }
    }
    static async deleteBill(req, res, next) {
        try {
            const billId = Number(req.params.id);
            if (!Number.isInteger(billId) || billId <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid bill id'));
            }
            await billing_service_1.BillingService.deleteBill(billId);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'ลบบิลสำเร็จ'));
        }
        catch (error) {
            next(error);
        }
    }
}
exports.BillingController = BillingController;
