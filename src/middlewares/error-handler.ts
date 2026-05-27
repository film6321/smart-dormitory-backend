import { Request, Response, NextFunction } from 'express';
import { createResponse } from '../shared/api-response';
import { logger } from '../logger';

export class AppError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Unknown error';
  logger.error({ err }, message);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json(createResponse(err.statusCode, err.message));
  }

  return res.status(500).json(createResponse(500, 'Internal Server Error'));
};