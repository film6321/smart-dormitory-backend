import { Express, Request, Response } from 'express';
import promClient from 'prom-client';
import { logger } from '../logger';
import { getNotificationWorkerStats } from '../workers/notificationWorker';

const httpRequestsTotal = new promClient.Counter({
  name: 'dormitory_http_requests_total',
  help: 'Total HTTP requests handled by the backend',
  labelNames: ['method', 'route', 'status_code'],
});

const httpRequestDuration = new promClient.Histogram({
  name: 'dormitory_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

export const setupMonitoring = (app: Express) => {
  promClient.collectDefaultMetrics({ prefix: 'dormitory_' });

  app.use((req, res, next) => {
    if (req.path === '/metrics') {
      return next();
    }

    const endTimer = httpRequestDuration.startTimer();
    res.on('finish', () => {
      const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
      const labels = {
        method: req.method,
        route,
        status_code: String(res.statusCode),
      };

      httpRequestsTotal.inc(labels);
      endTimer(labels);
    });

    return next();
  });

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
