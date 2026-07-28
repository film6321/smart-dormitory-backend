import { NextFunction, Request, Response } from 'express';
import { prisma } from '../database/db';
import { logger } from '../logger';
import { enqueueAccessLog, AccessLogJob } from '../workers/accessLogQueue';
import { AuthenticatedRequest } from './auth-jwt';

const ignoredPaths = ['/health', '/api/health', '/metrics'];

const shouldSkipAccessLog = (path: string): boolean => ignoredPaths.some((ignoredPath) => path.startsWith(ignoredPath));

const persistAccessLogFallback = async (log: AccessLogJob): Promise<void> => {
  try {
    await prisma.accessLog.create({
      data: {
        method: log.method,
        path: log.path,
        ip: log.ip,
        userId: log.userId,
        duration: log.duration,
        createdAt: new Date(log.createdAt),
      },
    });
  } catch (error) {
    logger.warn({ error }, 'Failed to persist access log fallback');
  }
};

export const accessLog = (req: Request, res: Response, next: NextFunction) => {
  if (shouldSkipAccessLog(req.path)) {
    next();
    return;
  }

  const start = Date.now();

  res.on('finish', () => {
    const log: AccessLogJob = {
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
      userId: (req as AuthenticatedRequest).user?.id,
      duration: Date.now() - start,
      createdAt: new Date().toISOString(),
    };

    logger.info(log);
    void enqueueAccessLog(log).catch((error) => {
      logger.warn({ error }, 'Failed to enqueue access log, writing directly to database');
      void persistAccessLogFallback(log);
    });
  });

  next();
};
