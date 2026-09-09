import { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middlewares/error-handler';
import { createResponse } from '../../shared/api-response';
import { AuditService } from './audit.service';

export class AuditController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Number(req.query.page ?? 1);
      const limit = Number(req.query.limit ?? 25);
      const userId = req.query.userId === undefined ? undefined : Number(req.query.userId);

      if (!Number.isInteger(page) || page <= 0 || !Number.isInteger(limit) || limit <= 0 || limit > 100) {
        return next(new AppError('Invalid pagination parameters', 400));
      }
      if (userId !== undefined && (!Number.isInteger(userId) || userId <= 0)) {
        return next(new AppError('Invalid user id', 400));
      }

      const data = await AuditService.list({
        page,
        limit,
        userId,
        method: typeof req.query.method === 'string' ? req.query.method : undefined,
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined,
      });
      return res.status(200).json(createResponse(200, 'Audit logs retrieved', data));
    } catch (error) {
      next(error);
    }
  }
}
