import { Prisma } from '@prisma/client';
import { prisma } from '../../database/db';

export class AuthRepository {
  static async findByEmail(email: string, db = prisma) {
    const client: any = db;
    return db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        username: true,
        password: true,
        role: true,
        firstName: true,
        lastName: true,
        lastLogin: true,
      },
    });
  }

  static async findByUsername(username: string, db = prisma) {
    const client: any = db;
    return client.user.findUnique({
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
    firstName?: string | null;
    lastName?: string | null;
    role: string;
    username?: string | null;
  }, db = prisma) {
    const client: any = db;
    return client.user.create({
      data: data as Prisma.UserCreateInput,
      select: { id: true, email: true, username: true, role: true, firstName: true, lastName: true, lastLogin: true, password: true },
    });
  }

  static async updateUser(id: number, data: Partial<Prisma.UserUpdateInput>, db = prisma) {
    const client: any = db;
    return client.user.update({ where: { id }, data: data as Prisma.UserUpdateInput });
  }
}
