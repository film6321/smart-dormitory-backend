import { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service';
import { createResponse } from '../../shared/api-response';

export class AuthController {
  
  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json(createResponse(400, 'กรุณากรอกอีเมลและรหัสผ่านให้ครบ'));
      }

      const data = await AuthService.login(email, password);
      return res.status(200).json(createResponse(200, 'เข้าสู่ระบบสำเร็จ', data));
    } catch (error) {
      next(error); // โยนเหวี่ยงให้ Middleware Error Catch เป็นคนจัดการ Response
    }
  }

  static async register(req: Request, res: Response, next: NextFunction) {
    try {
        const { email, password, firstName, lastName, role } = req.body;
        
        if (!email || !password) {
           return res.status(400).json(createResponse(400, 'กรุณากรอกอีเมลและรหัสผ่านให้ครบ'));
        }

        const data = await AuthService.register({ email, password, firstName, lastName, role });
        return res.status(201).json(createResponse(201, 'สมัครสมาชิกเรียบร้อย', data));
    } catch (error) {
        next(error);
    }
  }
}
