import { Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthenticatedRequest, requireRole, verifyToken } from '../../middlewares/auth-jwt';
import { createResponse } from '../../shared/api-response';
import { createRateLimitStore } from '../../shared/rate-limit-store';
import { AuthController } from './auth.controller';

const router = Router();

// ตั้งค่า Rate Limiter ที่เข็มแข็งสำหรับ Login (ป้องกัน Brute Force)
const loginLimiter = rateLimit({
  store: createRateLimitStore('rl:auth:login:'),
  windowMs: 5 * 60 * 1000, // 5 นาที
  max: 5, // จำกัด 5 ครั้ง
  message: { status: 429, message: 'Too many login attempts, please try again in 5 minutes' },
  skipSuccessfulRequests: true, // ไม่นับ login สำเร็จ
  standardHeaders: true,
  legacyHeaders: false,
});

// ตั้งค่า Rate Limiter สำหรับ Register
const registerLimiter = rateLimit({
  store: createRateLimitStore('rl:auth:register:'),
  windowMs: 60 * 60 * 1000, // 1 ชั่วโมง
  max: 3, // จำกัด 3 ครั้ง
  message: { status: 429, message: 'Too many registration attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// เส้นทางแบบเข้าถึงได้อิสระ (Public Routes) - มี Rate Limiting
router.post('/login', loginLimiter, AuthController.login);
router.post('/register', registerLimiter, AuthController.register);

// เส้นทางตัวอย่างเพื่อทดสอบ Token
router.get('/me', verifyToken, (req: AuthenticatedRequest, res: Response) => {
  res.json(createResponse(200, 'ดึงข้อมูลโปรไฟล์ได้สำเร็จ', { user: req.user }));
});

// เส้นทางตัวอย่างที่ให้เฉพาะ Admin เข้ามาได้
router.get('/admin-only', verifyToken, requireRole(['ADMIN']), (req: AuthenticatedRequest, res: Response) => {
  res.json(createResponse(200, 'ยินดีต้อนรับท่านผู้ดูแลระบบ'));
});

export default router;
