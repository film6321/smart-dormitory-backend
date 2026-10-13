import { AppError } from '../../middlewares/error-handler';
import { Prisma } from '@prisma/client';
import { prisma } from '../../database/db';

export class OcrRepository {
  static async createOcrJob(data: Prisma.OcrJobCreateInput, db = prisma) {
    return db.ocrJob.create({ data });
  }

  static async findOcrJobById(id: string, db = prisma) {
    return db.ocrJob.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        imagePath: true,
        userId: true,
        resultVerificationId: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
      },
    });
  }

  static async updateOcrJob(id: string, data: Prisma.OcrJobUpdateInput, db = prisma) {
    return db.ocrJob.update({ where: { id }, data });
  }

  static async createIdCardVerification(data: Prisma.IdCardVerificationCreateInput, db = prisma) {
    return db.idCardVerification.create({ data });
  }

  static async findIdCardVerificationById(id: number, db = prisma) {
    return db.idCardVerification.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        imagePath: true,
        isThaiIdCard: true,
        citizenIdMasked: true,
        fullNameTh: true,
        birthDateTh: true,
        issueDate: true,
        expiryDate: true,
        idDetected: true,
        idPresent: true,
        idChecksumValid: true,
        reason: true,
        ocrJobId: true,
        processingTimeMs: true,
        verifiedAt: true,
        createdAt: true,
      },
    });
  }

  static async deleteIdCardVerification(id: number, db = prisma) {
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "IdCardVerification" WHERE id = ${id} FOR UPDATE`;
      const verification = await tx.idCardVerification.findUnique({ where: { id }, select: { imagePath: true } });
      if (verification?.imagePath && await tx.visitor.count({ where: { idCardImagePath: verification.imagePath } })) {
        throw new AppError('ลบประวัติตรวจบัตรไม่ได้ เนื่องจากยังใช้เป็นหลักฐานของผู้มาติดต่อ', 409);
      }
      if (await tx.payment.count({ where: { housingVerificationId: id } })) {
        throw new AppError('ลบประวัติตรวจบัตรไม่ได้ เนื่องจากใช้เป็นหลักฐานการชำระเงินแล้ว', 409);
      }
      return tx.idCardVerification.delete({ where: { id } });
    });
  }

  static async listIdCardVerifications(page: number, limit: number, db = prisma) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const skip = (safePage - 1) * safeLimit;

    const [items, total] = await db.$transaction([
      db.idCardVerification.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: safeLimit,
        select: {
          id: true,
          userId: true,
          imagePath: true,
          isThaiIdCard: true,
          citizenIdMasked: true,
          fullNameTh: true,
          birthDateTh: true,
          idDetected: true,
          idPresent: true,
          idChecksumValid: true,
          reason: true,
          verifiedAt: true,
          createdAt: true,
        },
      }),
      db.idCardVerification.count(),
    ]);

    return {
      items,
      total,
      page: safePage,
      limit: safeLimit,
    };
  }
}
