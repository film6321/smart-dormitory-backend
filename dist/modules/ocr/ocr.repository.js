"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OcrRepository = void 0;
const error_handler_1 = require("../../middlewares/error-handler");
const db_1 = require("../../database/db");
class OcrRepository {
    static async createOcrJob(data, db = db_1.prisma) {
        return db.ocrJob.create({ data });
    }
    static async findOcrJobById(id, db = db_1.prisma) {
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
    static async updateOcrJob(id, data, db = db_1.prisma) {
        return db.ocrJob.update({ where: { id }, data });
    }
    static async createIdCardVerification(data, db = db_1.prisma) {
        return db.idCardVerification.create({ data });
    }
    static async findIdCardVerificationById(id, db = db_1.prisma) {
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
    static async deleteIdCardVerification(id, db = db_1.prisma) {
        return db.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT id FROM "IdCardVerification" WHERE id = ${id} FOR UPDATE`;
            if (await tx.payment.count({ where: { housingVerificationId: id } })) {
                throw new error_handler_1.AppError('ลบประวัติตรวจบัตรไม่ได้ เนื่องจากใช้เป็นหลักฐานการชำระเงินแล้ว', 409);
            }
            return tx.idCardVerification.delete({ where: { id } });
        });
    }
    static async listIdCardVerifications(page, limit, db = db_1.prisma) {
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
exports.OcrRepository = OcrRepository;
