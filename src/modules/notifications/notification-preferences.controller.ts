import { NextFunction, Request, Response } from 'express';
import { createResponse } from '../../shared/api-response';
import NotificationService from './notification.service';

export class NotificationPreferenceController {
  private static service = new NotificationService();

  private async getPreferences(userId: number) {
    return NotificationPreferenceController.service.listPreferences(userId);
  }

  static async listPreferences(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.id;
      const preferences = await new NotificationPreferenceController().getPreferences(userId);
      return res.status(200).json(createResponse(200, 'Notification preferences fetched successfully', preferences));
    } catch (error) {
      next(error);
    }
  }

  static async upsertPreference(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.id;
      const { channel, type, optedOut } = req.body;
      const preference = await NotificationPreferenceController.service.upsertPreference({ userId, channel, type, optedOut });
      return res.status(200).json(createResponse(200, 'Notification preference updated successfully', preference));
    } catch (error) {
      next(error);
    }
  }
}

export default NotificationPreferenceController;
