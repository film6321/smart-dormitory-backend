import { Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { AppError } from '../../middlewares/error-handler';
import { getJwtSecret } from '../../shared/env';
import { AuthRepository } from './auth.repository';

interface RegisterPayload {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  role?: Role;
}

// ฟังก์ชันตรวจสอบความเข็มแข็งของรหัสผ่าน
const validatePassword = (password: string): void => {
  if (!password || password.length < 8) {
    throw new AppError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร', 400);
  }
  if (!/[A-Z]/.test(password)) {
    throw new AppError('รหัสผ่านต้องมีตัวอักษรใหญ่อย่างน้อย 1 ตัว', 400);
  }
  if (!/[a-z]/.test(password)) {
    throw new AppError('รหัสผ่านต้องมีตัวอักษรเล็กอย่างน้อย 1 ตัว', 400);
  }
  if (!/[0-9]/.test(password)) {
    throw new AppError('รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว', 400);
  }
};

export class AuthService {
  static async login(email: string, passwordString: string) {
    const user = await AuthRepository.findByEmail(email);
    if (!user) {
      throw new AppError('อีเมลหรือรหัสผ่านไม่ถูกต้อง', 401);
    }

    const isValid = await bcrypt.compare(passwordString, user.password);
    if (!isValid) {
      throw new AppError('อีเมลหรือรหัสผ่านไม่ถูกต้อง', 401);
    }

    // เจนเนอเรต JWT Token (หมดอายุใน 1 วัน)
    const token = jwt.sign(
      { id: user.id, role: user.role },
      getJwtSecret(),
      { expiresIn: '1d' }
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      token
    };
  }

  static async register(data: RegisterPayload) {
    const { email, password, firstName, lastName, role } = data;
    
    // ตรวจสอบว่าอีเมลซ้ำไหม
    const existing = await AuthRepository.findByEmail(email);
    if (existing) {
      throw new AppError('อีเมลนี้ถูกใช้งานแล้ว', 400);
    }

    // ตรวจสอบความเข็มแข็งของรหัสผ่าน
    validatePassword(password);

    // แฮชรหัสผ่านเพื่อความปลอดภัยก่อนบันทึกลง Database
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await AuthRepository.createUser({
      email,
      password: hashedPassword,
      firstName,
      lastName,
      role: role || 'STUDENT'
    });

    return { id: user.id, email: user.email, role: user.role };
  }
}
