import { Prisma } from '@prisma/client';
import { prisma } from '../../database/db';

export class UsersRepository {
  static async listUsers(db = prisma) {
    const client: any = db;
    return db.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        firstName: true,
        lastName: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async getUserById(id: number, db = prisma) {
    const client: any = db;
    return db.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
        firstName: true,
        lastName: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  static async findByEmail(email: string, db = prisma) {
    const client: any = db;
    return db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        role: true,
        firstName: true,
        lastName: true,
        password: true,
      },
    });
  }

  static async createUser(data: {
    email: string;
    password: string;
    firstName?: string | null;
    lastName?: string | null;
    role: string;
  }, db = prisma) {
    const client: any = db;
    return client.user.create({
      data: data as Prisma.UserCreateInput,
      select: {
        id: true,
        email: true,
        role: true,
        firstName: true,
        lastName: true,
        password: true,
      },
    });
  }

  static async updateUser(id: number, data: Partial<Prisma.UserUpdateInput>, db = prisma) {
    const client: any = db;
    return client.user.update({ where: { id }, data: data as Prisma.UserUpdateInput });
  }

  static async deleteUser(id: number, db = prisma) {
    const client: any = db;
    return client.user.delete({ where: { id } });
  }
}
