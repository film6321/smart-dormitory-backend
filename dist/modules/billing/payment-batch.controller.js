"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentBatchController = void 0;
const api_response_1 = require("../../shared/api-response");
const payment_batch_service_1 = require("./payment-batch.service");
class PaymentBatchController {
    static async create(req, res, next) {
        try {
            const authReq = req;
            const idempotencyKey = req.header('Idempotency-Key')?.trim();
            const billIds = req.body?.billIds;
            if (!idempotencyKey) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Idempotency-Key header is required'));
            }
            if (!Array.isArray(billIds)) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'billIds must be an array'));
            }
            const data = await payment_batch_service_1.PaymentBatchService.create(authReq.user.id, billIds.map(Number), idempotencyKey);
            return res.status(201).json((0, api_response_1.createResponse)(201, 'Payment batch created', data));
        }
        catch (error) {
            return next(error);
        }
    }
    static async getById(req, res, next) {
        try {
            const authReq = req;
            const batchId = Number(req.params.id);
            if (!Number.isInteger(batchId) || batchId <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid payment batch id'));
            }
            const data = await payment_batch_service_1.PaymentBatchService.getById(batchId, authReq.user.id);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Payment batch retrieved', data));
        }
        catch (error) {
            return next(error);
        }
    }
    static async generateQr(req, res, next) {
        try {
            const authReq = req;
            const batchId = Number(req.params.id);
            if (!Number.isInteger(batchId) || batchId <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid payment batch id'));
            }
            const qrCode = await payment_batch_service_1.PaymentBatchService.generateQr(batchId, authReq.user.id);
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'private, no-store');
            return res.send(qrCode);
        }
        catch (error) {
            return next(error);
        }
    }
    static async uploadSlip(req, res, next) {
        try {
            const authReq = req;
            const batchId = Number(req.params.id);
            if (!Number.isInteger(batchId) || batchId <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid payment batch id'));
            }
            if (!req.file) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'slipImage file is required'));
            }
            const data = await payment_batch_service_1.PaymentBatchService.uploadSlip(batchId, authReq.user.id, req.file);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Payment batch verification completed', data));
        }
        catch (error) {
            return next(error);
        }
    }
    static async getAdminBillPaymentDetails(req, res, next) {
        try {
            const billId = Number(req.params.billId);
            if (!Number.isInteger(billId) || billId <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid bill id'));
            }
            const data = await payment_batch_service_1.PaymentBatchService.getAdminBillPaymentDetails(billId);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Payment details retrieved', data));
        }
        catch (error) {
            return next(error);
        }
    }
    static async getAdminBillSlip(req, res, next) {
        try {
            const billId = Number(req.params.billId);
            if (!Number.isInteger(billId) || billId <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid bill id'));
            }
            const filePath = await payment_batch_service_1.PaymentBatchService.getAdminBillSlipFile(billId);
            res.setHeader('Cache-Control', 'private, no-store');
            return res.sendFile(filePath);
        }
        catch (error) {
            return next(error);
        }
    }
}
exports.PaymentBatchController = PaymentBatchController;
