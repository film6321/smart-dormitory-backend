"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingController = void 0;
const api_response_1 = require("../../shared/api-response");
const billing_service_1 = require("./billing.service");
const error_handler_1 = require("../../middlewares/error-handler");
const state_transitions_1 = require("../../shared/state-transitions");
class BillingController {
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
    static async uploadSlip(req, res, next) {
        try {
            const billId = Number(req.params.id);
            if (!Number.isInteger(billId) || billId <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid bill id'));
            }
            const slipHash = `${Date.now()}-${billId}`;
            const bill = await billing_service_1.BillingService.uploadSlip(billId, slipHash);
            return res.status(202).json((0, api_response_1.createResponse)(202, 'Slip upload accepted', bill));
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
}
exports.BillingController = BillingController;
