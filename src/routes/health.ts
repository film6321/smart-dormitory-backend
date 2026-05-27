import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/db';
import { createResponse } from '../shared/api-response';

const healthRouter = Router();

healthRouter.get('/', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return res.status(200).json(
      createResponse(200, 'OK', {
        status: 'healthy',
        timestamp: new Date().toISOString(),
      })
    );
  } catch {
    return res.status(503).json(
      createResponse(503, 'Service Unavailable', {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
      })
    );
  }
});

export default healthRouter;
