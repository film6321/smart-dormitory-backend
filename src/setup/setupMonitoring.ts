import { Express, Request, Response } from 'express';
import promClient from 'prom-client';

export const setupMonitoring = (app: Express) => {
  // บันทึกสถิติขั้นพื้นฐานของ Node (RAM, CPU, Request)
  const collectDefaultMetrics = promClient.collectDefaultMetrics;
  collectDefaultMetrics({ prefix: 'dormitory_' });

  // แขวนป้ายบอกทางให้โปรแกรมภายนอกเข้ามารับค่า
  app.get('/metrics', async (req: Request, res: Response) => {
    try {
      res.set('Content-Type', promClient.register.contentType);
      const metrics = await promClient.register.metrics();
      res.status(200).send(metrics);
    } catch (ex) {
      res.status(500).send(ex);
    }
  });

  console.log('✅ Prometheus Monitoring Initialized at /metrics');
};
