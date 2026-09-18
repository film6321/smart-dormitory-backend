import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from './error-handler';
import { getJwtSecret } from '../shared/env';
import { Role } from '@prisma/client';

// ขยาย Interface ของ Request ให้รองรับคีย์ user ที่เราจะยัดตอนถอดรหัส
export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    role: Role;
  };
}

// 1. Middleware สำหรับตรวจ Token ว่าส่งมาไหม และเป็นของจริงไหม
export const verifyToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1]; // รับค่าจาก Header แบบ "Bearer <token>"

  const cookieToken = (req.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('access_token='))
    ?.slice('access_token='.length);
  const queryToken = typeof req.query?.token === 'string' ? req.query.token.trim() : undefined;
  const resolvedToken = token || cookieToken || queryToken;

  if (!resolvedToken) {
    return next(new AppError('ไม่อนุญาตให้เข้าถึง: ไม่พบ Token', 401));
  }

  try {
    const decoded = jwt.verify(
      resolvedToken,
      getJwtSecret()
    ) as { id: number; role: Role };

    // แปะข้อมูล user ลงใน Request เพื่อให้ Controller เอาไปใช้งานต่อได้
    req.user = decoded; 
    next();
  } catch {
    return next(new AppError('ไม่อนุญาตให้เข้าถึง: Token หมดอายุหรือไม่ถูกต้อง', 401));
  }
};

// 2. Middleware แยกส่วนที่เอาไว้ตรวจจำกัดสิทธิ์เฉพาะบาง Role เช่น ADMIN เท่านั้น
export const requireRole = (roles: Role[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('ไม่อนุญาตให้เข้าถึง: ไม่พบข้อมูลผู้ใช้', 401));
    }

    if (!roles.includes(req.user.role)) {
      return next(new AppError('ถูกปฏิเสธ: คุณไม่มีสิทธิ์เข้าถึงส่วนนี้', 403));
    }
    
    next();
  };
};
