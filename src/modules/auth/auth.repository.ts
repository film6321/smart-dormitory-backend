import { prisma } from '../../database/db';
import { Prisma, Role } from '@prisma/client';
export class AuthRepository {
  static async findByEmail(email: string, db = prisma) {
    return db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        createdAt: true,
        lastLogin: true,
        updatedAt: true,
        password: true,
      },
    });
  }

  static async findByUsername(username: string, db = prisma) {
    return db.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
      },
    });
  }

  static async createUser(data: {
    email: string;
    password: string;
    role: Role;
    username?: string | null;
  }, db = prisma) {

    return db.user.create({
      data: data as Prisma.UserCreateInput,
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        lastLogin: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  static async updateUser(id: number, data: Partial<Prisma.UserUpdateInput>, db = prisma) {
    return db.user.update({ where: { id }, data: data as Prisma.UserUpdateInput });
  }
}
