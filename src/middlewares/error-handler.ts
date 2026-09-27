import { Prisma } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';
import { createResponse } from '../shared/api-response';
import { logger } from '../logger';

export class AppError extends Error {
  public statusCode: number;
  public details?: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Unknown error';
  logger.error({ err }, message);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json(createResponse(err.statusCode, err.message));
  }

  if (_req.method === 'DELETE' && err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2003') return res.status(409).json(createResponse(409, 'ลบไม่ได้ เนื่องจากมีข้อมูลที่เกี่ยวข้องหรือประวัติที่ต้องเก็บรักษา'));
    if (err.code === 'P2025') return res.status(404).json(createResponse(404, 'ไม่พบข้อมูลที่ต้องการลบ'));
    if (err.code === 'P2034') return res.status(409).json(createResponse(409, 'ข้อมูลกำลังถูกแก้ไข กรุณาลองใหม่'));
  }

  return res.status(500).json(createResponse(500, 'Internal Server Error'));
};