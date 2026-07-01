import { NextFunction, Request, Response } from 'express';
import { createResponse } from '../../shared/api-response';
import { MaintenanceService } from './maintenance.service';
import { AuthenticatedRequest } from '../../middlewares/auth-jwt';
import { AppError } from '../../middlewares/error-handler';
import { canTransitionMaintenanceStatus } from '../../shared/state-transitions';

export class MaintenanceController {
  static async createTicket(req: Request, res: Response, next: NextFunction) {
    try {
      const authReq = req as AuthenticatedRequest;
      const { roomId, category, description, contactTime } = req.body;

      const ticket = await MaintenanceService.createTicket({
        tenantId: authReq.user?.id ?? 0,
        roomId,
        category,
        description,
        contactTime: contactTime ? new Date(contactTime) : undefined,
      });

      return res.status(201).json(createResponse(201, 'Maintenance ticket created', ticket));
    } catch (error) {
      next(error);
    }
  }

  static async listTickets(req: Request, res: Response, next: NextFunction) {
    try {
      const authReq = req as AuthenticatedRequest;
      const tickets = await MaintenanceService.listTickets(authReq.user?.id, authReq.user?.role);
      return res.status(200).json(createResponse(200, 'Maintenance tickets fetched', tickets));
    } catch (error) {
      next(error);
    }
  }

  static async updateTicketStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const { status, note } = req.body;

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid ticket id'));
      }

      const existingTicket = await MaintenanceService.getTicketById(id);
      if (!existingTicket) {
        return res.status(404).json(createResponse(404, 'Maintenance ticket not found'));
      }

      if (!canTransitionMaintenanceStatus(existingTicket.status, status)) {
        return next(new AppError('Invalid maintenance state transition', 409));
      }

      const updated = await MaintenanceService.updateTicketStatus(id, status, note);
      return res.status(200).json(createResponse(200, 'Maintenance ticket updated', updated));
    } catch (error) {
      next(error);
    }
  }
}
