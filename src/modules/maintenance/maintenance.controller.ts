import { requestBody, text, optionalText } from '../../shared/input';
import { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { createResponse } from '../../shared/api-response';
import { MaintenanceService } from './maintenance.service';
import { AuthenticatedRequest } from '../../middlewares/auth-jwt';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ConfirmMaintenanceDto } from './maintenance.dto';

export class MaintenanceController {
  static async confirmTicket(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json(createResponse(400, 'Invalid ticket id'));
      if (!requestBody(req.body) || typeof requestBody(req.body) !== 'object' || Array.isArray(requestBody(req.body))
        || validateSync(plainToInstance(ConfirmMaintenanceDto, requestBody(req.body)), { whitelist: true, forbidNonWhitelisted: true }).length) {
        return res.status(400).json(createResponse(400, 'Please confirm the completed repair'));
      }
      const updated = await MaintenanceService.confirmTicket(id, (req as AuthenticatedRequest).user!.id);
      return res.status(200).json(createResponse(200, 'Maintenance ticket confirmed', updated));
    } catch (error) { next(error); }
  }

  static async createTicket(req: Request, res: Response, next: NextFunction) {
    try {
      const authReq = req as AuthenticatedRequest;
      const { roomId, category, description, contactTime } = requestBody(req.body);

      const tenant = await MaintenanceService.getTenantByUserId(authReq.user?.id ?? 0);
      if (!tenant) {
        return res.status(404).json(createResponse(404, 'Tenant profile not found. Please complete your registration first.'));
      }

      // Validate contactTime upfront — prevent invalid dates from reaching PostgreSQL
      let parsedContactTime: Date | undefined;
      if (contactTime !== undefined && contactTime !== null) {
        parsedContactTime = new Date(text(contactTime));
        if (isNaN(parsedContactTime.getTime())) {
          return res.status(400).json(createResponse(400, 'contactTime must be a valid ISO 8601 date string (e.g. 2026-09-14T10:00:00.000Z)'));
        }
      }

      const ticket = await MaintenanceService.createTicket({
        tenantId: tenant.id,
        roomId: roomId === undefined ? tenant.roomId ?? undefined : Number(roomId),
        category: text(category),
        description: text(description),
        contactTime: parsedContactTime,
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
      const { status, note } = requestBody(req.body);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid ticket id'));
      }

      const updated = await MaintenanceService.updateTicketStatus(id, text(status), optionalText(note));
      return res.status(200).json(createResponse(200, 'Maintenance ticket updated', updated));
    } catch (error) {
      next(error);
    }
  }

  static async deleteTicket(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid ticket id'));
      }

      const existingTicket = await MaintenanceService.getTicketById(id);
      if (!existingTicket) {
        return res.status(404).json(createResponse(404, 'Maintenance ticket not found'));
      }

      await MaintenanceService.deleteTicket(id);
      return res.status(200).json(createResponse(200, 'Maintenance ticket deleted'));
    } catch (error) {
      next(error);
    }
  }

  static async uploadImage(req: Request, res: Response, next: NextFunction) {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json(createResponse(400, 'Image file is required'));
      }

      const data = await MaintenanceService.uploadImage(file, (req as AuthenticatedRequest).user!.id);
      return res.status(200).json(createResponse(200, 'Image uploaded successfully', data));
    } catch (error) {
      next(error);
    }
  }

  static async serveImage(req: Request, res: Response, next: NextFunction) {
    try {
      const filename = req.params.filename as string;
      const uploadDir = path.resolve(process.env.UPLOAD_ROOT || path.join(process.cwd(), 'uploads/maintenance'));
      const filepath = path.resolve(uploadDir, path.basename(filename));

      if (!filepath.startsWith(`${uploadDir}${path.sep}`)) {
        return res.status(400).json(createResponse(400, 'Invalid image path'));
      }

      if (!fs.existsSync(filepath)) {
        return res.status(404).json(createResponse(404, 'Image not found'));
      }

      return res.sendFile(filepath);
    } catch (error) {
      next(error);
    }
  }
}
