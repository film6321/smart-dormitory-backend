import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../modules/auth/auth.service';
import { AppError } from './error-handler';
import { Role } from '@prisma/client';

// ขยาย Interface ของ Request ให้รองรับคีย์ user ที่เราจะยัดตอนถอดรหัส
export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    role: Role;
  };
}

// 1. Middleware สำหรับตรวจ Token ว่าส่งมาไหม และเป็นของจริงไหม
export const verifyToken = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1]; // รับค่าจาก Header แบบ "Bearer <token>"

  const cookieToken = (req.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('access_token='))
    ?.slice('access_token='.length);
  const resolvedToken = token || cookieToken;

  if (!resolvedToken) {
    return next(new AppError('ไม่อนุญาตให้เข้าถึง: ไม่พบ Token', 401));
  }

  try {
    const decoded = await AuthService.authenticateToken(resolvedToken);

    // แปะข้อมูล user ลงใน Request เพื่อให้ Controller เอาไปใช้งานต่อได้
    req.user = decoded; 
    next();
  } catch (error) {
    if (!(error instanceof AppError)) return next(error);
    return next(new AppError('ไม่อนุญาตให้เข้าถึง: Token หมดอายุหรือไม่ถูกต้อง', 401));
  }
};

export const optionalVerifyToken = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  const cookieToken = (req.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('access_token='))
    ?.slice('access_token='.length);
  const resolvedToken = token || cookieToken;

  if (!resolvedToken) {
    return next();
  }

  try {
    const decoded = await AuthService.authenticateToken(resolvedToken);
    req.user = decoded;
    next();
  } catch {
    next();
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
