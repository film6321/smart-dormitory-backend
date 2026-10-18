import { disconnectUserSessions, disconnectReplacedSessions } from '../../realtime/notification-gateway';
import { Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { logger } from '../../logger';
import { AppError } from '../../middlewares/error-handler';
import { getJwtSecret } from '../../shared/env';
import { markUserOnline } from '../../shared/presence';
import { getSettingValue } from '../settings/settings.service';
import { AuthRepository } from './auth.repository';
import { normalizeThaiMobilePhone } from './phone-utils';

interface RegisterPayload {
  email: string;
  phone: string;
  password: string;
  username?: string;
}

// ฟังก์ชันตรวจสอบความเข็มแข็งของรหัสผ่าน
const validatePassword = async (password: string): Promise<void> => {
  const policy = (await getSettingValue('passwordPolicy')).trim().toLowerCase();
  if (!password || password.length < 8) {
    throw new AppError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร', 400);
  }
  if (policy === 'ผ่อนปรน' || policy === 'relaxed') return;
  if (!/[A-Z]/.test(password)) {
    throw new AppError('รหัสผ่านต้องมีตัวอักษรใหญ่อย่างน้อย 1 ตัว', 400);
  }
  if (!/[a-z]/.test(password)) {
    throw new AppError('รหัสผ่านต้องมีตัวอักษรเล็กอย่างน้อย 1 ตัว', 400);
  }
  if (!/[0-9]/.test(password)) {
    throw new AppError('รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว', 400);
  }
  if (policy === 'เข้มงวด' || policy === 'strict') {
    if (!/[^A-Za-z0-9]/.test(password)) {
      throw new AppError('รหัสผ่านแบบเข้มงวดต้องมีอักขระพิเศษอย่างน้อย 1 ตัว', 400);
    }
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
  static async authenticateToken(token: string) {
    let decoded: jwt.JwtPayload;
    try {
      const payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
      if (typeof payload === 'string') throw new Error('Invalid payload');
      decoded = payload;
    } catch {
      throw new AppError('ไม่อนุญาตให้เข้าถึง: Token หมดอายุหรือไม่ถูกต้อง', 401);
    }
    if (typeof decoded.id !== 'number' || !Number.isInteger(decoded.id) || decoded.id <= 0 || !Number.isInteger(decoded.sessionVersion)) {
      throw new AppError('กรุณาเข้าสู่ระบบใหม่', 401);
    }
    const user = await AuthRepository.findSessionUser(decoded.id);
    if (!user || user.authSessionVersion !== decoded.sessionVersion || user.role !== decoded.role) {
      throw new AppError('Session ถูกยกเลิกแล้ว กรุณาเข้าสู่ระบบใหม่', 401);
    }
    return { id: user.id, role: user.role, sessionVersion: user.authSessionVersion };
  }

  static async logout(userId: number) {
    await AuthRepository.revokeSessions(userId);
  }

  static async login(email: string, passwordString: string) {
    const user = await AuthRepository.findByEmail(email);
    if (!user) {
      throw new AppError('อีเมลหรือรหัสผ่านไม่ถูกต้อง', 401);
    }

    const isValid = await bcrypt.compare(passwordString, user.password);
    if (!isValid) {
      throw new AppError('อีเมลหรือรหัสผ่านไม่ถูกต้อง', 401);
    }

    const sessionTimeoutMinutes = Number(await getSettingValue('sessionTimeoutMinutes')) || 30;
    const secret = getJwtSecret();
    const lastLogin = new Date();
    let session;
    try {
      session = await AuthRepository.startLoginSession(user.id, user.password, lastLogin);
    } catch (error) {
      if (getPrismaErrorCode(error) === 'P2025') throw new AppError('บัญชีหรือรหัสผ่านเปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่', 401);
      if (getPrismaErrorCode(error) !== 'P2022') {
        throw error;
      }
      logger.error({ error, userId: user.id }, 'Cannot persist successful login timestamp');
      throw new AppError('ไม่สามารถบันทึกการเข้าสู่ระบบได้ กรุณาลองใหม่', 503);
    }

    const token = jwt.sign(
      { id: session.id, role: session.role, sessionVersion: session.authSessionVersion },
      secret,
      { expiresIn: `${sessionTimeoutMinutes}m` }
    );
    disconnectReplacedSessions(user.id, session.authSessionVersion);

    await markUserOnline(user.id, lastLogin);

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: session.role,
        lastLogin: normalizeLastLogin(lastLogin),
        isOnline: true,
      },
      token,
      sessionTimeoutMinutes,
    };
  }

  static async register(data: RegisterPayload) {
    const { email, password, username } = data;
    const phone = normalizeThaiMobilePhone(data.phone);
    if (!phone) throw new AppError('กรุณากรอกเบอร์โทรศัพท์มือถือไทยให้ถูกต้อง', 400);
    const normalizedUsername = typeof username === 'string' ? username.trim() : undefined;
    const finalUsername = normalizedUsername ? normalizedUsername : undefined;
    
    // ตรวจสอบว่าอีเมลซ้ำไหม
    const existing = await AuthRepository.findByEmail(email);
    if (existing) {
      throw new AppError('อีเมลนี้ถูกใช้งานแล้ว', 400);
    }

    if (await AuthRepository.findByPhone(phone)) {
      throw new AppError('เบอร์โทรศัพท์นี้ถูกผูกกับบัญชีแล้ว', 409);
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
    await validatePassword(password);

    // แฮชรหัสผ่านเพื่อความปลอดภัยก่อนบันทึกลง Database
    const hashedPassword = await bcrypt.hash(password, 10);

    const createPayload = {
      email,
      phone,
      password: hashedPassword,
      role: Role.STUDENT,
      username: finalUsername,
    };

    try {
      const user = await AuthRepository.createUser(createPayload);
      return { id: user.id, email: user.email, role: user.role };
    } catch (error) {
      if (getPrismaErrorCode(error) === 'P2002') {
        throw new AppError('อีเมลหรือชื่อผู้ใช้นี้ถูกใช้งานแล้ว', 400);
      }

      if (finalUsername && getPrismaErrorCode(error) === 'P2022') {
        logger.warn({ error }, 'Username column is not available yet, creating user without username');
        try {
          const user = await AuthRepository.createUser({
            email,
            phone,
            password: hashedPassword,
            role: Role.STUDENT,
          });
          return { id: user.id, email: user.email, role: user.role };
        } catch (innerError) {
          if (getPrismaErrorCode(innerError) === 'P2002') {
            throw new AppError('อีเมลนี้ถูกใช้งานแล้ว', 400);
          }
          throw innerError;
        }
      }

      throw error;
    }
  }

  static async resetPassword(rawPhone: string, token: string, password: string): Promise<void> {
    const phone = normalizeThaiMobilePhone(rawPhone);
    if (!phone || !/^[a-f0-9]{64}$/i.test(token)) throw new AppError('ข้อมูลยืนยันการตั้งรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว', 400);
    const userId = await AuthRepository.findUniqueUserIdByPhone(phone);
    if (userId === null) throw new AppError('ข้อมูลยืนยันการตั้งรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว', 400);
    await validatePassword(password);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const passwordHash = await bcrypt.hash(password, 10);
    const updated = await AuthRepository.consumePasswordResetGrant(
      userId,
      tokenHash,
      passwordHash,
      new Date(),
    );

    if (updated.count !== 1) {
      throw new AppError('ข้อมูลยืนยันการตั้งรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว', 400);
    }
    disconnectUserSessions(userId);
  }
}
