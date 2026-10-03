import { Request, Response, NextFunction } from 'express';
import { AppError } from './error-handler';

export const validateDto = (schema: Record<string, (value: unknown) => boolean>) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return next(new AppError('Validation Failed', 400, [{ property: 'body', constraints: { isObject: 'Body must be an object' } }]));
      }

      const errors = Object.entries(schema)
        .filter(([property, validator]) => !validator((req.body as Record<string, unknown>)[property]))
        .map(([property]) => ({ property, constraints: { isValid: `${property} is invalid` } }));

      if (errors.length > 0) {
        return next(new AppError('Validation Failed', 400, errors));
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
