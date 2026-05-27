import { AppError } from '../middlewares/error-handler';

export const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new AppError('JWT_SECRET is not configured', 500);
  }

  return secret;
};
