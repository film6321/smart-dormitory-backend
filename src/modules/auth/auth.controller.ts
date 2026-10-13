import { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service';
import { createResponse } from '../../shared/api-response';
import { AuthenticatedRequest } from '../../middlewares/auth-jwt';
import { markUserOnline } from '../../shared/presence';
import { clearUserPresenceWhenDisconnected, disconnectUserSessions, publishUserPresence } from '../../realtime/notification-gateway';
import { AppError } from '../../middlewares/error-handler';
import { recordLoginAttempt } from '../../setup/observability-metrics';
import { plainToInstance } from 'class-transformer';
import { isEmail, isNotEmpty, isString, matches } from 'class-validator';
import { PasswordResetOtpService } from './password-reset-otp.service';
import { normalizeThaiMobilePhone } from './phone-utils';

class LoginRequestDto { email!: string; password!: string; }
class RegisterRequestDto { email!: string; phone!: string; password!: string; username?: string; }
class ForgotPasswordRequestDto { phone!: string; }
class VerifyPasswordResetOtpDto { phone!: string; otp!: string; }
class ResetPasswordRequestDto { phone!: string; token!: string; password!: string; }

export class AuthController {
  
  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json(createResponse(400, 'กรุณากรอกอีเมลและรหัสผ่านให้ถูกต้อง'));
      }
      const input = plainToInstance(LoginRequestDto, req.body);
      if (!isString(input.email) || !isEmail(input.email)
        || !isString(input.password) || !isNotEmpty(input.password)) {
        return res.status(400).json(createResponse(400, 'กรุณากรอกอีเมลและรหัสผ่านให้ถูกต้อง'));
      }

      const data = await AuthService.login(input.email, input.password);
      recordLoginAttempt('success');
      publishUserPresence(data.user.id, true);
      res.cookie('access_token', data.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: data.sessionTimeoutMinutes * 60 * 1000,
        path: '/',
      });
      return res.status(200).json(createResponse(200, 'เข้าสู่ระบบสำเร็จ', { user: data.user }));
    } catch (error) {
      recordLoginAttempt(error instanceof AppError && error.statusCode === 401 ? 'invalid_credentials' : 'error');
      next(error); // โยนเหวี่ยงให้ Middleware Error Catch เป็นคนจัดการ Response
    }
  }

  static async register(req: Request, res: Response, next: NextFunction) {
    try {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
          throw new AppError('กรุณากรอกข้อมูลสมัครสมาชิกให้ถูกต้อง', 400);
        }
        const input = plainToInstance(RegisterRequestDto, req.body);
        if (!isString(input.email) || !isEmail(input.email) || input.email.length > 254
          || !isString(input.password) || input.password.length < 8 || Buffer.byteLength(input.password, 'utf8') > 72
          || !isString(input.phone) || !normalizeThaiMobilePhone(input.phone)
          || (input.username !== undefined && (!isString(input.username) || !input.username.trim() || input.username.length > 100))) {
          throw new AppError('กรุณากรอกอีเมล เบอร์โทรศัพท์ ชื่อผู้ใช้ และรหัสผ่านให้ถูกต้อง', 400);
        }
        const data = await AuthService.register({ email: input.email, phone: input.phone, password: input.password, username: input.username });
        return res.status(201).json(createResponse(201, 'สมัครสมาชิกเรียบร้อย', data));
    } catch (error) {
        next(error);
    }
  }

  static async requestPasswordReset(req: Request, res: Response, next: NextFunction) {
    try {
      const input = plainToInstance(ForgotPasswordRequestDto, req.body);
      if (!isString(input.phone)) {
        throw new AppError('กรุณากรอกเบอร์โทรศัพท์', 400);
      }

      const receipt = await PasswordResetOtpService.requestCode(input.phone);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(createResponse(
        200,
        'สร้าง OTP สำหรับทดสอบแล้ว',
        receipt,
      ));
    } catch (error) {
      next(error);
    }
  }

  static async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const input = plainToInstance(ResetPasswordRequestDto, req.body);
      if (!isString(input.phone) || !isString(input.token) || !matches(input.token, /^[a-f0-9]{64}$/i)) {
        throw new AppError('ข้อมูลยืนยันการตั้งรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว', 400);
      }
      if (!isString(input.password)) {
        throw new AppError('กรุณากรอกรหัสผ่านใหม่', 400);
      }

      await AuthService.resetPassword(input.phone, input.token, input.password);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(createResponse(200, 'ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบ'));
    } catch (error) {
      next(error);
    }
  }

  static async verifyPasswordResetOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const input = plainToInstance(VerifyPasswordResetOtpDto, req.body);
      if (!isString(input.phone) || !isString(input.otp) || !matches(input.otp, /^\d{6}$/)) {
        throw new AppError('กรุณากรอกเบอร์โทรศัพท์และ OTP 6 หลัก', 400);
      }

      const data = await PasswordResetOtpService.verifyCode(input.phone, input.otp);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(createResponse(200, 'ยืนยัน OTP สำเร็จ', data));
    } catch (error) {
      next(error);
    }
  }

  static async heartbeat(req: Request, res: Response, next: NextFunction) {
    try {
      const authedReq = req as AuthenticatedRequest;
      const userId = authedReq.user?.id;
      if (!userId) {
        return res.status(401).json(createResponse(401, 'Unauthorized'));
      }

      await markUserOnline(userId);
      publishUserPresence(userId, true);
      return res.status(200).json(createResponse(200, 'Heartbeat received', { userId, online: true }));
    } catch (error) {
      next(error);
    }
  }

  static async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const authedReq = req as AuthenticatedRequest;
      const userId = authedReq.user?.id;
      if (userId) {
        await AuthService.logout(userId);
        disconnectUserSessions(userId);
        await clearUserPresenceWhenDisconnected(userId);
      }

      res.clearCookie('access_token', { httpOnly: true, sameSite: 'lax', path: '/' });
      return res.status(200).json(createResponse(200, 'Logged out successfully'));
    } catch (error) {
      next(error);
    }
  }
}
