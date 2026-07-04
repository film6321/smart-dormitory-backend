import { Express, Request, Response } from 'express';
import promClient from 'prom-client';
import { logger } from '../logger';
import { getNotificationWorkerStats } from '../workers/notificationWorker';

export const setupMonitoring = (app: Express) => {
  promClient.collectDefaultMetrics({ prefix: 'dormitory_' });

  app.get('/metrics', async (_req: Request, res: Response) => {
    try {
      res.set('Content-Type', promClient.register.contentType);
      const metrics = await promClient.register.metrics();
      res.status(200).send(metrics);
    } catch (error) {
      res.status(500).send(error);
    }
  });

  app.get('/health/notifications', (_req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      data: getNotificationWorkerStats(),
    });
  });

  logger.info('Prometheus monitoring initialized at /metrics');
};
