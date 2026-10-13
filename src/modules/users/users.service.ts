import { AccountRetentionService } from './account-retention.service';
import { disconnectUserSessions, publishAdminAlert } from '../../realtime/notification-gateway';
import bcrypt from 'bcrypt';
import { plainToInstance } from 'class-transformer';
import { isIn, isString, matches } from 'class-validator';
import { Role } from '@prisma/client';
import { AppError } from '../../middlewares/error-handler';
import { resolveUsersPresence } from '../../shared/presence';
import { UsersRepository } from './users.repository';
import { type DbClient } from '../../database/db';

export interface CreateUserInput {
  email: string;
  password: string;
  username?: string;
  phone?: string | null;
  role?: string;
}

class UserPhoneDto { phone?: string | null; }

export class UsersService {
  static validatePhone(data: unknown): string | null | undefined {
    const input = plainToInstance(UserPhoneDto, data);
    if (!input || input.phone === undefined) return undefined;
    if (input.phone === null) return null;
    if (!isString(input.phone)) throw new AppError('กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง', 400);
    const phone = input.phone.trim().replace(/[ -]/g, '');
    if (!phone) return null;
    if (!matches(phone, /^0\d{8,9}$/)) throw new AppError('กรุณากรอกเบอร์โทรศัพท์ 9–10 หลักที่ขึ้นต้นด้วย 0', 400);
    return phone;
  }

  private static withDisplayName<T extends {
    username?: string | null;
    email?: string;
    isOnline?: boolean;
    lastLogin?: Date | string | null;
  }>(user: T | null) {
    if (!user) {
      return user;
    }

    const displayName = user.username?.trim() || user.email || '';

    return {
      ...user,
      displayName,
      name: displayName,
      fullName: displayName,
      isOnline: user.isOnline ?? true,
    };
  }

  static async listUsers(db?: DbClient) {
    const users = await UsersRepository.listUsers(db);
    const presence = await resolveUsersPresence(users.map((user) => ({ id: user.id, lastLogin: user.lastLogin })));
    return users.map((user) => UsersService.withDisplayName({
      ...user,
      isOnline: presence[user.id]?.isOnline,
    }));
  }

  static async getUserById(id: number, db?: DbClient) {
    const user = await UsersRepository.getUserById(id, db);
    const presence = await resolveUsersPresence(user ? [{ id: user.id, lastLogin: user.lastLogin }] : []);
    return UsersService.withDisplayName(user ? {
      ...user,
      isOnline: presence[user.id]?.isOnline,
    } : user);
  }

  static async createUser(data: CreateUserInput, db?: DbClient) {
    if (data.role !== undefined && (!isString(data.role) || !isIn(data.role.toUpperCase(), Object.values(Role)))) throw new AppError('Invalid user role', 400);
    const phone = this.validatePhone(data);
    const email = data.email.trim().toLowerCase();
    const username = typeof data.username === 'string' ? data.username.trim() : undefined;
    const existing = await UsersRepository.findByEmail(email, db);
    if (existing) {
      throw new AppError('Email already exists', 409);
    }

    if (!data.password || data.password.length < 8) {
      throw new AppError('Password must be at least 8 characters', 400);
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);
    const user = await UsersRepository.createUser({
      email,
      password: hashedPassword,
      username: username || null,
      ...(phone !== undefined ? { phone } : {}),
      role: (data.role ?? 'STUDENT').toUpperCase(),
    }, db);
    publishAdminAlert(user.id, 'USER_STATUS', `เพิ่มผู้ใช้งานใหม่: ${user.email}`, 'ACTIVE');
    return UsersService.withDisplayName(user);
  }

  static async updateUser(id: number, data: Partial<CreateUserInput>, db?: DbClient) {
    if (data.role !== undefined && (!isString(data.role) || !isIn(data.role.toUpperCase(), Object.values(Role)))) throw new AppError('Invalid user role', 400);
    const payload: Record<string, unknown> = {};
    const phone = this.validatePhone(data);
    if (phone !== undefined) payload.phone = phone;
    if (data.email) payload.email = data.email.trim().toLowerCase();
    if (data.username !== undefined) payload.username = data.username?.trim() ?? null;
    if (data.role) payload.role = data.role.toUpperCase();
    if (data.password) {
      payload.password = await bcrypt.hash(data.password, 10);
    }

    const existing = data.role ? await UsersRepository.getUserById(id, db) : null;
    const revokeSessions = Boolean(data.password || (data.role && existing?.role !== data.role.toUpperCase()));
    if (revokeSessions) payload.authSessionVersion = { increment: 1 };
    const user = await UsersRepository.updateUser(id, payload, db);
    if (user) {
      if (revokeSessions) disconnectUserSessions(id);
      publishAdminAlert(user.id, 'USER_STATUS', `อัปเดตผู้ใช้งาน: ${user.email}`, 'ACTIVE');
    }
    return UsersService.withDisplayName(user);
  }

  static async deleteUser(id: number, db?: DbClient) {
    const cleanup = await AccountRetentionService.deleteUser(id, db);
    disconnectUserSessions(id);
    publishAdminAlert(id, 'USER_STATUS', `ลบผู้ใช้งาน #${id}${cleanup.status === 'PENDING' ? ' รอล้างไฟล์และข้อมูลใบหน้า' : ''}`, cleanup.status === 'PENDING' ? 'CLEANUP_PENDING' : 'DELETED');
    return { cleanup };
  }
}
