import { Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { logger } from '../../logger';
import { AppError } from '../../middlewares/error-handler';
import { getJwtSecret } from '../../shared/env';
import { markUserOnline } from '../../shared/presence';
import { AuthRepository } from './auth.repository';

interface RegisterPayload {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  role?: Role;
  username?: string;
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

const getPrismaErrorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  return (error as { code?: string }).code;
};

const normalizeLastLogin = (value: unknown): string => {
  if (!value) {
    return '-';
  }

  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toISOString();
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

    const lastLogin = new Date();
    try {
      await AuthRepository.updateUser(user.id, { lastLogin }, undefined);
    } catch (error) {
      if (getPrismaErrorCode(error) !== 'P2022') {
        throw error;
      }
      logger.warn({ error, userId: user.id }, 'lastLogin column is not available yet, skipping login timestamp update');
    }

    await markUserOnline(user.id, lastLogin);

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        lastLogin: normalizeLastLogin(lastLogin),
        isOnline: true,
      },
      token
    };
  }

  static async register(data: RegisterPayload) {
    const { email, password, firstName, lastName, role, username } = data;
    const normalizedUsername = typeof username === 'string' ? username.trim() : undefined;
    const finalUsername = normalizedUsername ? normalizedUsername : undefined;
    
    // ตรวจสอบว่าอีเมลซ้ำไหม
    const existing = await AuthRepository.findByEmail(email);
    if (existing) {
      throw new AppError('อีเมลนี้ถูกใช้งานแล้ว', 400);
    }

    if (finalUsername) {
      try {
        const existingUsername = await AuthRepository.findByUsername(finalUsername);
        if (existingUsername) {
          throw new AppError('ชื่อผู้ใช้นี้ถูกใช้งานแล้ว', 400);
        }
      } catch (error) {
        if (getPrismaErrorCode(error) !== 'P2022') {
          throw error;
        }

        logger.warn({ error }, 'Username column is not available yet, skipping username uniqueness check');
      }
    }

    // ตรวจสอบความเข็มแข็งของรหัสผ่าน
    validatePassword(password);

    // แฮชรหัสผ่านเพื่อความปลอดภัยก่อนบันทึกลง Database
    const hashedPassword = await bcrypt.hash(password, 10);

    const createPayload = {
      email,
      password: hashedPassword,
      firstName,
      lastName,
      role: role || 'STUDENT',
      username: finalUsername,
    };

    try {
      const user = await AuthRepository.createUser(createPayload);
      return { id: user.id, email: user.email, role: user.role };
    } catch (error) {
      if (finalUsername && getPrismaErrorCode(error) === 'P2022') {
        logger.warn({ error }, 'Username column is not available yet, creating user without username');
        const user = await AuthRepository.createUser({
          email,
          password: hashedPassword,
          firstName,
          lastName,
          role: role || 'STUDENT',
        });
        return { id: user.id, email: user.email, role: user.role };
      }

      throw error;
    }
  }
}
