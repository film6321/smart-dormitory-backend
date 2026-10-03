import { prisma } from '../../database/db';
import { Prisma, Role } from '@prisma/client';
import { getThaiMobilePhoneVariants } from './phone-utils';
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
    phone?: string;
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

  static async findUniqueUserIdByPhone(phone: string, db = prisma): Promise<number | null> {
    const variants = getThaiMobilePhoneVariants(phone);
    const users = await db.user.findMany({
      where: {
        OR: [
          { phone: { in: variants } },
          { phone: null, tenant: { is: { phone: { in: variants } } } },
        ],
      },
      select: { id: true },
    });
    const userIds = Array.from(new Set(users.map(({ id }) => id)));
    return userIds.length === 1 ? userIds[0] : null;
  }

  static async findByPhone(phone: string, db = prisma) {
    return db.user.findUnique({ where: { phone }, select: { id: true } });
  }

  static async setPasswordResetOtp(userId: number, otpHash: string, expiresAt: Date, db = prisma) {
    return db.user.update({
      where: { id: userId },
      data: {
        passwordResetOtpHash: otpHash,
        passwordResetOtpExpiresAt: expiresAt,
        passwordResetOtpAttempts: 0,
        passwordResetGrantHash: null,
        passwordResetGrantExpiresAt: null,
      },
    });
  }

  static async findActivePasswordResetOtp(userId: number, now: Date, db = prisma) {
    return db.user.findFirst({
      where: {
        id: userId,
        passwordResetOtpExpiresAt: { gt: now },
        passwordResetOtpAttempts: { lt: 5 },
        passwordResetOtpHash: { not: null },
      },
      select: { passwordResetOtpHash: true, passwordResetOtpAttempts: true },
    });
  }

  static async incrementPasswordResetOtpAttempts(userId: number, now: Date, db = prisma) {
    return db.user.updateMany({
      where: {
        id: userId,
        passwordResetOtpHash: { not: null },
        passwordResetOtpExpiresAt: { gt: now },
        passwordResetOtpAttempts: { lt: 5 },
      },
      data: { passwordResetOtpAttempts: { increment: 1 } },
    });
  }

  static async issuePasswordResetGrant(userId: number, otpHash: string, grantHash: string, now: Date, expiresAt: Date, db = prisma) {
    return db.user.updateMany({
      where: {
        id: userId,
        passwordResetOtpHash: otpHash,
        passwordResetOtpExpiresAt: { gt: now },
        passwordResetOtpAttempts: { lt: 5 },
      },
      data: {
        passwordResetOtpHash: null,
        passwordResetOtpExpiresAt: null,
        passwordResetOtpAttempts: 0,
        passwordResetGrantHash: grantHash,
        passwordResetGrantExpiresAt: expiresAt,
      },
    });
  }

  static async consumePasswordResetGrant(userId: number, grantHash: string, passwordHash: string, now: Date, db = prisma) {
    return db.user.updateMany({
      where: { id: userId, passwordResetGrantHash: grantHash, passwordResetGrantExpiresAt: { gt: now } },
      data: {
        password: passwordHash,
        passwordResetOtpHash: null,
        passwordResetOtpExpiresAt: null,
        passwordResetOtpAttempts: 0,
        passwordResetGrantHash: null,
        passwordResetGrantExpiresAt: null,
      },
    });
  }
}
