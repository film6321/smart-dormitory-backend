import bcrypt from 'bcrypt';
import { AppError } from '../../middlewares/error-handler';
import { resolveUsersPresence } from '../../shared/presence';
import { UsersRepository } from './users.repository';
import { type DbClient } from '../../database/db';

export interface CreateUserInput {
  email: string;
  password: string;
  username?: string;
  role?: string;
}

export class UsersService {
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
      role: (data.role ?? 'STUDENT').toUpperCase(),
    }, db);
    return UsersService.withDisplayName(user);
  }

  static async updateUser(id: number, data: Partial<CreateUserInput>, db?: DbClient) {
    const payload: Record<string, unknown> = {};
    if (data.email) payload.email = data.email.trim().toLowerCase();
    if (data.username !== undefined) payload.username = data.username?.trim() ?? null;
    if (data.role) payload.role = data.role.toUpperCase();
    if (data.password) {
      payload.password = await bcrypt.hash(data.password, 10);
    }

    const user = await UsersRepository.updateUser(id, payload, db);
    return UsersService.withDisplayName(user);
  }

  static async deleteUser(id: number, db?: DbClient) {
    return UsersRepository.deleteUser(id, db);
  }
}
