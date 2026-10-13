import { AppError } from '../../middlewares/error-handler';
import { Prisma } from '@prisma/client';
import { prisma, type DbClient } from '../../database/db';

export class UsersRepository {
  private static readonly baseUserSelect = {
    id: true,
    email: true,
    phone: true,
    role: true,
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
    phone?: string | null;
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
    try {
      return await db.user.update({ where: { id }, data: data as Prisma.UserUpdateInput, select: UsersRepository.usernameUserSelect });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002' && data.phone !== undefined) {
        throw new AppError('เบอร์โทรศัพท์หรือข้อมูลบัญชีนี้ถูกใช้แล้ว กรุณาตรวจสอบข้อมูลอีกครั้ง', 409);
      }
      if ((error as { code?: string })?.code === 'P2025') throw new AppError('ไม่พบบัญชีผู้ใช้', 404);
      throw error;
    }
  }

  static async deleteUser(id: number, db: DbClient = prisma) {
    const remove = async (transaction: Prisma.TransactionClient) => {
      await transaction.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
      const record = await transaction.user.findUnique({ where: { id }, include: { _count: true } });
      if (!record) throw new AppError('ไม่พบผู้ใช้ที่ต้องการลบ', 404);
      if (Object.values(record._count).some((count) => count > 0)) {
        throw new AppError('ลบผู้ใช้ไม่ได้ เนื่องจากมีข้อมูลหรือประวัติที่เกี่ยวข้องอยู่', 409);
      }
      return transaction.user.delete({ where: { id } });
    };
    return typeof db.$transaction === 'function'
      ? (db as typeof prisma).$transaction(remove) : remove(db);
  }
}
