import { NextFunction, Request, Response } from 'express';
import { createResponse } from '../../shared/api-response';
import { AppError } from '../../middlewares/error-handler';
import { canTransitionVisitorStatus } from '../../shared/state-transitions';
import { VisitorService } from './visitor.service';

export class VisitorController {
  static async registerVisitor(req: Request, res: Response, next: NextFunction) {
    try {
      const { guestName, purpose, roomId, tenantId, expectedEntryTime } = req.body;
      const visitor = await VisitorService.registerVisitor({
        guestName,
        purpose,
        roomId,
        tenantId,
        expectedEntryTime: expectedEntryTime ? new Date(expectedEntryTime) : undefined,
      });

      return res.status(201).json(createResponse(201, 'Visitor registered', visitor));
    } catch (error) {
      next(error);
    }
  }

  static async listVisitors(req: Request, res: Response, next: NextFunction) {
    try {
      const visitors = await VisitorService.listVisitors();
      return res.status(200).json(createResponse(200, 'Visitors fetched', visitors));
    } catch (error) {
      next(error);
    }
  }

  static async updateVisitorStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const { status } = req.body;

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid visitor id'));
      }

      const existingVisitor = await VisitorService.getVisitorById(id);
      if (!existingVisitor) {
        return res.status(404).json(createResponse(404, 'Visitor not found'));
      }

      if (!canTransitionVisitorStatus(existingVisitor.status, status)) {
        return next(new AppError('Invalid visitor state transition', 409));
      }

      const updated = await VisitorService.updateVisitorStatus(id, status);
      return res.status(200).json(createResponse(200, 'Visitor status updated', updated));
    } catch (error) {
      next(error);
    }
  }
}
