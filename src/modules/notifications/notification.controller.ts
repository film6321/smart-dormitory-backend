import { NextFunction, Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../middlewares/auth-jwt';
import { createResponse } from '../../shared/api-response';
import NotificationService from './notification.service';

export class NotificationController {
  private static service?: NotificationService;

  private static getService() {
    if (!NotificationController.service) {
      NotificationController.service = new NotificationService();
    }
    return NotificationController.service;
  }

  static async listNotifications(req: Request, res: Response, next: NextFunction) {
    try {
      const authUser = (req as AuthenticatedRequest).user as { id?: number; role?: string } | undefined;
      const userId = authUser?.role === 'ADMIN' ? undefined : authUser?.id;
      const notifications = await NotificationController.getService().listNotifications(userId);
      return res.status(200).json(createResponse(200, 'Notifications fetched successfully', notifications));
    } catch (error) {
      next(error);
    }
  }

  static async createNotification(req: Request, res: Response, next: NextFunction) {
    try {
      const notification = await NotificationController.getService().scheduleNotification(req.body);
      return res.status(201).json(createResponse(201, 'Notification scheduled successfully', notification));
    } catch (error) {
      next(error);
    }
  }

  static async sendNotification(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid notification id'));
      }

      const result = await NotificationController.getService().sendNotification(id);
      return res.status(200).json(createResponse(200, 'Notification sent successfully', result));
    } catch (error) {
      next(error);
    }
  }

  static async handleProviderWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await NotificationController.getService().handleProviderWebhook(req.body ?? {});
      return res.status(200).json(createResponse(200, 'Webhook processed', result));
    } catch (error) {
      next(error);
    }
  }

  static async listDeadLetters(req: Request, res: Response, next: NextFunction) {
    try {
      const deadLetters = await NotificationController.getService().listDeadLetters();
      return res.status(200).json(createResponse(200, 'Dead letters fetched successfully', deadLetters));
    } catch (error) {
      next(error);
    }
  }

  static async listAuditLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const notificationId = req.query.notificationId ? Number(req.query.notificationId) : undefined;
      const auditLogs = await NotificationController.getService().listAuditLogs(notificationId);
      return res.status(200).json(createResponse(200, 'Audit logs fetched successfully', auditLogs));
    } catch (error) {
      next(error);
    }
  }

  static async retryDeadLetter(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid dead letter id'));
      }

      const result = await NotificationController.getService().retryDeadLetter(id);
      return res.status(200).json(createResponse(200, 'Dead letter retried successfully', result));
    } catch (error) {
      next(error);
    }
  }

  static async deleteDeadLetter(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid dead letter id'));
      }

      const result = await NotificationController.getService().deleteDeadLetter(id);
      return res.status(200).json(createResponse(200, 'Dead letter deleted successfully', result));
    } catch (error) {
      next(error);
    }
  }
}

export default NotificationController;
