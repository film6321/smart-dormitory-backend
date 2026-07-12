import bcrypt from 'bcrypt';
import { AppError } from '../../middlewares/error-handler';
import { UsersRepository } from './users.repository';

export interface CreateUserInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  role?: string;
}

export class UsersService {
  static async listUsers(db?: any) {
    return UsersRepository.listUsers(db);
  }

  static async getUserById(id: number, db?: any) {
    return UsersRepository.getUserById(id, db);
  }

  static async createUser(data: CreateUserInput, db?: any) {
    const email = data.email.trim().toLowerCase();
    const existing = await UsersRepository.findByEmail(email, db);
    if (existing) {
      throw new AppError('Email already exists', 409);
    }

    if (!data.password || data.password.length < 8) {
      throw new AppError('Password must be at least 8 characters', 400);
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);
    return UsersRepository.createUser({
      email,
      password: hashedPassword,
      firstName: data.firstName?.trim() ?? null,
      lastName: data.lastName?.trim() ?? null,
      role: (data.role ?? 'STUDENT').toUpperCase(),
    }, db);
  }

  static async updateUser(id: number, data: Partial<CreateUserInput>, db?: any) {
    const payload: Record<string, unknown> = {};
    if (data.email) payload.email = data.email.trim().toLowerCase();
    if (data.firstName !== undefined) payload.firstName = data.firstName?.trim() ?? null;
    if (data.lastName !== undefined) payload.lastName = data.lastName?.trim() ?? null;
    if (data.role) payload.role = data.role.toUpperCase();
    if (data.password) {
      payload.password = await bcrypt.hash(data.password, 10);
    }

    return UsersRepository.updateUser(id, payload, db);
  }

  static async deleteUser(id: number, db?: any) {
    return UsersRepository.deleteUser(id, db);
  }
}
