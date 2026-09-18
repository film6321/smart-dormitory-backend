import { NextFunction, Request, Response } from 'express';
import { createResponse } from '../../shared/api-response';
import { AnalyticsService } from './analytics.service';

export class AnalyticsController {
  static async getDashboardAnalytics(req: Request, res: Response, next: NextFunction) {
    try {
      const analytics = await AnalyticsService.getDashboardAnalytics();
      return res.status(200).json(createResponse(200, 'Dashboard analytics retrieved successfully', analytics));
    } catch (error) {
      next(error);
    }
  }

  static async getPrometheusMetrics(req: Request, res: Response, next: NextFunction) {
    try {
      const rawMetrics = await AnalyticsService.getPrometheusMetricsRaw();
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      return res.status(200).send(rawMetrics);
    } catch (error) {
      next(error);
    }
  }
}
