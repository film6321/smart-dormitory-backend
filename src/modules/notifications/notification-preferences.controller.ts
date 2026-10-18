import { requestBody, text, optionalText, booleanValue } from '../../shared/input';
import { NextFunction, Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../middlewares/auth-jwt';
import { createResponse } from '../../shared/api-response';
import NotificationService from './notification.service';

export class NotificationPreferenceController {
  private static service = new NotificationService();

  private async getPreferences(userId?: number) {
    return NotificationPreferenceController.service.listPreferences(userId);
  }

  static async listPreferences(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as AuthenticatedRequest).user?.id;
      const preferences = await new NotificationPreferenceController().getPreferences(userId);
      return res.status(200).json(createResponse(200, 'Notification preferences fetched successfully', preferences));
    } catch (error) {
      next(error);
    }
  }

  static async upsertPreference(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as AuthenticatedRequest).user?.id;
      const { channel, type, optedOut } = requestBody(req.body);
      const preference = await NotificationPreferenceController.service.upsertPreference({ userId, channel: text(channel), type: optionalText(type), optedOut: booleanValue(optedOut) });
      return res.status(200).json(createResponse(200, 'Notification preference updated successfully', preference));
    } catch (error) {
      next(error);
    }
  }
}

export default NotificationPreferenceController;
