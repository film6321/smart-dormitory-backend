import { NextFunction, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth-jwt';
import { createResponse } from '../../shared/api-response';
import { PaymentBatchService } from './payment-batch.service';

export class PaymentBatchController {
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const authReq = req as AuthenticatedRequest;
      const idempotencyKey = req.header('Idempotency-Key')?.trim();
      const billIds = req.body?.billIds;

      if (!idempotencyKey) {
        return res.status(400).json(createResponse(400, 'Idempotency-Key header is required'));
      }

      if (!Array.isArray(billIds)) {
        return res.status(400).json(createResponse(400, 'billIds must be an array'));
      }

      const data = await PaymentBatchService.create(authReq.user!.id, billIds.map(Number), idempotencyKey);
      return res.status(201).json(createResponse(201, 'Payment batch created', data));
    } catch (error) {
      return next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const authReq = req as AuthenticatedRequest;
      const batchId = Number(req.params.id);
      if (!Number.isInteger(batchId) || batchId <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid payment batch id'));
      }

      const data = await PaymentBatchService.getById(batchId, authReq.user!.id);
      return res.status(200).json(createResponse(200, 'Payment batch retrieved', data));
    } catch (error) {
      return next(error);
    }
  }

  static async generateQr(req: Request, res: Response, next: NextFunction) {
    try {
      const authReq = req as AuthenticatedRequest;
      const batchId = Number(req.params.id);
      if (!Number.isInteger(batchId) || batchId <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid payment batch id'));
      }

      const qrCode = await PaymentBatchService.generateQr(batchId, authReq.user!.id);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, no-store');
      return res.send(qrCode);
    } catch (error) {
      return next(error);
    }
  }

  static async uploadSlip(req: Request, res: Response, next: NextFunction) {
    try {
      const authReq = req as AuthenticatedRequest;
      const batchId = Number(req.params.id);
      if (!Number.isInteger(batchId) || batchId <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid payment batch id'));
      }
      if (!req.file) {
        return res.status(400).json(createResponse(400, 'slipImage file is required'));
      }

      const data = await PaymentBatchService.uploadSlip(batchId, authReq.user!.id, req.file);
      return res.status(200).json(createResponse(200, 'Payment batch verification completed', data));
    } catch (error) {
      return next(error);
    }
  }

  static async getAdminBillPaymentDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const billId = Number(req.params.billId);
      if (!Number.isInteger(billId) || billId <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid bill id'));
      }
      const data = await PaymentBatchService.getAdminBillPaymentDetails(billId);
      const safeData = {
        bill: {
          id: data.bill.id,
          tenantId: data.bill.tenantId,
          roomId: data.bill.roomId,
          amount: Number(data.bill.amount),
          rentAmount: Number(data.bill.rentAmount),
          electricAmount: Number(data.bill.electricAmount),
          waterAmount: Number(data.bill.waterAmount),
          penaltyAmount: Number(data.bill.penaltyAmount),
          dueDate: data.bill.dueDate,
          status: data.bill.status,
          description: data.bill.description,
          reason: data.bill.reason,
          paidAt: data.bill.paidAt,
          createdAt: data.bill.createdAt,
          updatedAt: data.bill.updatedAt,
        },
        payments: data.payments.map((payment) => ({
          id: payment.id,
          billId: payment.billId,
          amount: payment.amount,
          status: payment.status,
          provider: payment.provider,
          providerTransactionId: payment.providerTransactionId,
          slipAmount: payment.slipAmount,
          transferAt: payment.transferAt,
          failureReason: payment.failureReason,
          verifiedAt: payment.verifiedAt,
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
        })),
        batches: data.batches.map((batch) => ({
          id: batch.id,
          payerUserId: batch.payerUserId,
          amount: batch.amount,
          status: batch.status,
          provider: batch.provider,
          slipAmount: batch.slipAmount,
          transferAt: batch.transferAt,
          providerTransactionId: batch.providerTransactionId,
          failureReason: batch.failureReason,
          verifiedAt: batch.verifiedAt,
          createdAt: batch.createdAt,
          updatedAt: batch.updatedAt,
        })),
      };
      return res.status(200).json(createResponse(200, 'Payment details retrieved', safeData));
    } catch (error) {
      return next(error);
    }
  }

  static async getAdminBillSlip(req: Request, res: Response, next: NextFunction) {
    try {
      const billId = Number(req.params.billId);
      if (!Number.isInteger(billId) || billId <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid bill id'));
      }
      const filePath = await PaymentBatchService.getAdminBillSlipFile(billId);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.sendFile(filePath);
    } catch (error) {
      return next(error);
    }
  }
}