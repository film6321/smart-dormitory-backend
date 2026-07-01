import { NextFunction, Request, Response } from 'express';
import { createResponse } from '../../shared/api-response';
import { BillingService } from './billing.service';
import { AuthenticatedRequest } from '../../middlewares/auth-jwt';
import { AppError } from '../../middlewares/error-handler';
import { canTransitionBillStatus } from '../../shared/state-transitions';

export class BillingController {
  static async listBills(req: Request, res: Response, next: NextFunction) {
    try {
      const authReq = req as AuthenticatedRequest;
      const bills = await BillingService.listBills(authReq.user?.id, authReq.user?.role);
      return res.status(200).json(createResponse(200, 'Bills fetched successfully', bills));
    } catch (error) {
      next(error);
    }
  }

  static async uploadSlip(req: Request, res: Response, next: NextFunction) {
    try {
      const billId = Number(req.params.id);
      if (!Number.isInteger(billId) || billId <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid bill id'));
      }

      const slipHash = `${Date.now()}-${billId}`;
      const bill = await BillingService.uploadSlip(billId, slipHash);
      return res.status(202).json(createResponse(202, 'Slip upload accepted', bill));
    } catch (error) {
      next(error);
    }
  }

  static async updateBillStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const billId = Number(req.params.id);
      const { status, reason } = req.body;

      if (!Number.isInteger(billId) || billId <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid bill id'));
      }

      const existingBill = await BillingService.getBillById(billId);
      if (!existingBill) {
        return res.status(404).json(createResponse(404, 'Bill not found'));
      }

      if (!canTransitionBillStatus(existingBill.status, status)) {
        return next(new AppError('Invalid bill state transition', 409));
      }

      const updated = await BillingService.updateBillStatus(billId, status, reason);
      return res.status(200).json(createResponse(200, 'Bill status updated', updated));
    } catch (error) {
      next(error);
    }
  }
}
