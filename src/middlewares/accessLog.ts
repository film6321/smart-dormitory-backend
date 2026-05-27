import { NextFunction, Request, Response } from 'express';
import { prisma } from '../database/db';
import { logger } from '../logger';
import { AuthenticatedRequest } from './auth-jwt';

export const accessLog = async (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', async () => {
        const duration = Date.now() - start;
        const log = {
            method: req.method,
            path: req.originalUrl,
            ip: req.ip,
            userId: (req as AuthenticatedRequest).user?.id,
            duration,
        };
        try {
            // Log to console/file
            logger.info(log);
            // Persist to DB
            await prisma.accessLog.create({ data: log });
        } catch (error) {
            logger.warn({ error }, 'Failed to write access log');
        }
    });
    next();
};
