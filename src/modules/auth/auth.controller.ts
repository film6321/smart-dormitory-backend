import { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service';
import { createResponse } from '../../shared/api-response';
import { AuthenticatedRequest } from '../../middlewares/auth-jwt';
import { clearUserOnline, markUserOnline } from '../../shared/presence';

export class AuthController {
  
  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json(createResponse(400, 'กรุณากรอกอีเมลและรหัสผ่านให้ครบ'));
      }

      const data = await AuthService.login(email, password);
      res.cookie('access_token', data.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: data.sessionTimeoutMinutes * 60 * 1000,
        path: '/',
      });
      return res.status(200).json(createResponse(200, 'เข้าสู่ระบบสำเร็จ', { user: data.user }));
    } catch (error) {
      next(error); // โยนเหวี่ยงให้ Middleware Error Catch เป็นคนจัดการ Response
    }
  }

  static async register(req: Request, res: Response, next: NextFunction) {
    try {
        const { email, password, firstName, lastName, role, username } = req.body;
        
        if (!email || !password) {
           return res.status(400).json(createResponse(400, 'กรุณากรอกอีเมลและรหัสผ่านให้ครบ'));
        }

        const data = await AuthService.register({ email, password, firstName, lastName, role, username });
        return res.status(201).json(createResponse(201, 'สมัครสมาชิกเรียบร้อย', data));
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
        await clearUserOnline(userId);
      }

      res.clearCookie('access_token', { httpOnly: true, sameSite: 'lax', path: '/' });
      return res.status(200).json(createResponse(200, 'Logged out successfully'));
    } catch (error) {
      next(error);
    }
  }
}
