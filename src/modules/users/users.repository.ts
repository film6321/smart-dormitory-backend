import { Prisma } from '@prisma/client';
import { prisma, type DbClient } from '../../database/db';

export class UsersRepository {
  private static readonly baseUserSelect = {
    id: true,
    email: true,
    lastLogin: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.UserSelect;

  private static readonly usernameUserSelect = {
    ...UsersRepository.baseUserSelect,
    username: true,
  } satisfies Prisma.UserSelect;

  static async listUsers(db: DbClient = prisma) {
    try {
      return await db.user.findMany({
        select: UsersRepository.usernameUserSelect,
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      if ((error as { code?: string } | null | undefined)?.code !== 'P2022') {
        throw error;
      }

      return db.user.findMany({
        select: UsersRepository.baseUserSelect,
        orderBy: { createdAt: 'desc' },
      });
    }
  }

  static async getUserById(id: number, db: DbClient = prisma) {
    try {
      return await db.user.findUnique({
        where: { id },
        select: UsersRepository.usernameUserSelect,
      });
    } catch (error) {
      if ((error as { code?: string } | null | undefined)?.code !== 'P2022') {
        throw error;
      }

      return db.user.findUnique({
        where: { id },
        select: UsersRepository.baseUserSelect,
      });
    }
  }

  static async findByEmail(email: string, db: DbClient = prisma) {
    return db.user.findUnique({
      where: { email },
      select: {
        ...UsersRepository.baseUserSelect,
      },
    });
  }

  static async createUser(data: {
    email: string;
    password: string;
    username?: string | null;
    lastLogin?: Date | string | null;
    role: string;
  }, db: DbClient = prisma) {
    try {
      return await db.user.create({
        data: data as Prisma.UserCreateInput,
        select: {
          id: true,
          email: true,
          role: true,
        },
      });
    } catch (error) {
      if ((error as { code?: string } | null | undefined)?.code !== 'P2022') {
        throw error;
      }

      const fallbackData = { ...data };
      delete fallbackData.username;
      return db.user.create({
        data: fallbackData as Prisma.UserCreateInput,
        select: {
          id: true,
          email: true,
          role: true,
        },
      });
    }
  }

  static async updateUser(id: number, data: Partial<Prisma.UserUpdateInput>, db: DbClient = prisma) {
    return db.user.update({ where: { id }, data: data as Prisma.UserUpdateInput });
  }

  static async deleteUser(id: number, db: DbClient = prisma) {
    return db.user.delete({ where: { id } });
  }
}
