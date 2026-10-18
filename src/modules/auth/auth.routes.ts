import { requestBody } from '../../shared/input';
import { Request, Response, Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { createHash } from 'node:crypto';
import { AuthenticatedRequest, requireRole, verifyToken } from '../../middlewares/auth-jwt';
import { createResponse } from '../../shared/api-response';
import { createRateLimitStore } from '../../shared/rate-limit-store';
import { AuthController } from './auth.controller';
import { normalizeThaiMobilePhone } from './phone-utils';

const router = Router();

const getAccountRateLimitKey = (req: Request): string => {
  const value = requestBody(req.body).email;
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email) {
    return ipKeyGenerator(req.ip ?? '127.0.0.1');
  }

  return createHash('sha256').update(email).digest('hex');
};

const getPhoneRateLimitKey = (req: Request): string => {
  const value = requestBody(req.body).phone;
  const rawPhone = typeof value === 'string' ? value : '';
  const phone = normalizeThaiMobilePhone(rawPhone);
  return phone ? createHash('sha256').update(phone).digest('hex') : ipKeyGenerator(req.ip ?? '127.0.0.1');
};

// Limit failed attempts per normalized account so one user cannot block
// unrelated accounts that share the same network or device.
const loginLimiter = rateLimit({
  store: createRateLimitStore('rl:auth:login:'),
  windowMs: 5 * 60 * 1000, // 5 นาที
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 5), // จำกัด 5 ครั้งต่อบัญชี
  keyGenerator: getAccountRateLimitKey,
  message: createResponse(429, 'บัญชีนี้พยายามเข้าสู่ระบบหลายครั้ง กรุณาลองใหม่ใน 5 นาที'),
  skipSuccessfulRequests: true, // ไม่นับ login สำเร็จ
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordResetRequestLimiter = rateLimit({
  store: createRateLimitStore('rl:auth:password-reset-request:'),
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: getPhoneRateLimitKey,
  message: createResponse(429, 'ส่งคำขอได้ไม่เกิน 3 ครั้งต่อชั่วโมง กรุณาลองใหม่ภายหลัง'),
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordResetLimiter = rateLimit({
  store: createRateLimitStore('rl:auth:password-reset:'),
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: getPhoneRateLimitKey,
  message: createResponse(429, 'มีการลองตั้งรหัสผ่านหลายครั้ง กรุณาลองใหม่ภายหลัง'),
  standardHeaders: true,
  legacyHeaders: false,
});

// ตั้งค่า Rate Limiter สำหรับ Register
const registerLimiter = rateLimit({
  store: createRateLimitStore('rl:auth:register:'),
  windowMs: 60 * 60 * 1000, // 1 ชั่วโมง
  max: Number(process.env.REGISTER_RATE_LIMIT_MAX || 10), // จำกัด 10 ครั้งต่อ IP ต่อชั่วโมง รวมการกรอกผิด
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? '127.0.0.1'),
  message: createResponse(429, 'Too many registration attempts, please try again later'),
  standardHeaders: true,
  legacyHeaders: false,
});

// เส้นทางแบบเข้าถึงได้อิสระ (Public Routes) - มี Rate Limiting
router.post('/login', loginLimiter, AuthController.login);
router.post('/register', registerLimiter, AuthController.register);
router.post('/forgot-password', passwordResetRequestLimiter, AuthController.requestPasswordReset);
router.post('/verify-reset-otp', passwordResetLimiter, AuthController.verifyPasswordResetOtp);
router.post('/reset-password', passwordResetLimiter, AuthController.resetPassword);
router.post('/heartbeat', verifyToken, AuthController.heartbeat);
router.post('/logout', verifyToken, AuthController.logout);

// เส้นทางตัวอย่างเพื่อทดสอบ Token
router.get('/me', verifyToken, (req: AuthenticatedRequest, res: Response) => {
  res.json(createResponse(200, 'ดึงข้อมูลโปรไฟล์ได้สำเร็จ', { user: req.user }));
});

// เส้นทางตัวอย่างที่ให้เฉพาะ Admin เข้ามาได้
router.get('/admin-only', verifyToken, requireRole(['ADMIN']), (req: AuthenticatedRequest, res: Response) => {
  res.json(createResponse(200, 'ยินดีต้อนรับท่านผู้ดูแลระบบ'));
});

export default router;
