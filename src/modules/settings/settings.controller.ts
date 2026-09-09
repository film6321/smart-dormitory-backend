import { NextFunction, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth-jwt';
import { createResponse } from '../../shared/api-response';
import { SettingsService } from './settings.service';

export class SettingsController {
  static async get(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await SettingsService.get();
      return res.status(200).json(createResponse(200, 'System settings fetched successfully', data));
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as AuthenticatedRequest).user!.id;
      const data = await SettingsService.update(req.body, userId);
      return res.status(200).json(createResponse(200, 'System settings updated successfully', data));
    } catch (error) {
      next(error);
    }
  }
}
