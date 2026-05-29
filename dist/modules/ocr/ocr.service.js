"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OcrService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const db_1 = require("../../database/db");
const error_handler_1 = require("../../middlewares/error-handler");
const normalizeBaseUrl = (url) => url.replace(/\/+$/, '');
const privateUploadRoot = path_1.default.resolve(process.cwd(), 'uploads/private/id-cards');
const getOcrConfig = () => {
    const baseUrl = process.env.OCR_API_BASE_URL;
    const apiKey = process.env.OCR_API_KEY;
    if (!baseUrl) {
        throw new error_handler_1.AppError('OCR_API_BASE_URL is not configured', 500);
    }
    if (!apiKey) {
        throw new error_handler_1.AppError('OCR_API_KEY is not configured', 500);
    }
    return {
        baseUrl: normalizeBaseUrl(baseUrl),
        apiKey,
    };
};
const getStringValue = (value) => {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed && trimmed !== '-' ? trimmed : undefined;
};
const stripDataUrlPrefix = (imageBase64) => {
    const commaIndex = imageBase64.indexOf(',');
    return imageBase64.startsWith('data:') && commaIndex >= 0
        ? imageBase64.slice(commaIndex + 1)
        : imageBase64;
};
const getImageExtension = (imageBase64) => {
    const match = imageBase64.match(/^data:image\/(png|jpe?g|webp);base64,/i);
    const extension = match?.[1]?.toLowerCase();
    if (extension === 'jpeg') {
        return 'jpg';
    }
    return extension ?? 'jpg';
};
const maskCitizenId = (citizenId) => {
    const normalized = citizenId.replace(/\D/g, '');
    if (normalized.length < 5) {
        return '*'.repeat(normalized.length);
    }
    return `${normalized.slice(0, 3)}${'*'.repeat(Math.max(normalized.length - 5, 0))}${normalized.slice(-2)}`;
};
const hashCitizenId = (citizenId) => crypto_1.default.createHash('sha256').update(citizenId).digest('hex');
const savePrivateIdCardImage = async (imageBase64, sanitizedImage) => {
    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const extension = getImageExtension(imageBase64);
    const fileName = `${crypto_1.default.randomUUID()}.${extension}`;
    const directory = path_1.default.join(privateUploadRoot, year, month);
    const absolutePath = path_1.default.join(directory, fileName);
    await promises_1.default.mkdir(directory, { recursive: true });
    await promises_1.default.writeFile(absolutePath, Buffer.from(sanitizedImage, 'base64'), { mode: 0o600 });
    return path_1.default.relative(process.cwd(), absolutePath).replace(/\\/g, '/');
};
const resolvePrivateImagePath = (imagePath) => {
    const absolutePath = path_1.default.resolve(process.cwd(), imagePath);
    const privateRootWithSeparator = `${privateUploadRoot}${path_1.default.sep}`;
    if (absolutePath !== privateUploadRoot && !absolutePath.startsWith(privateRootWithSeparator)) {
        throw new error_handler_1.AppError('Stored image path is outside private upload directory', 500);
    }
    return absolutePath;
};
const deletePrivateImageIfExists = async (imagePath) => {
    if (!imagePath) {
        return false;
    }
    const absolutePath = resolvePrivateImagePath(imagePath);
    try {
        await promises_1.default.unlink(absolutePath);
        return true;
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
};
const getImageContentType = (imagePath) => {
    const extension = path_1.default.extname(imagePath).toLowerCase();
    if (extension === '.png') {
        return 'image/png';
    }
    if (extension === '.webp') {
        return 'image/webp';
    }
    return 'image/jpeg';
};
const toSummary = (verification) => ({
    id: verification.id,
    userId: verification.userId,
    isThaiIdCard: verification.isThaiIdCard,
    citizenIdMasked: verification.citizenIdMasked,
    fullNameTh: verification.fullNameTh,
    birthDateTh: verification.birthDateTh,
    idDetected: verification.idDetected,
    idPresent: verification.idPresent,
    idChecksumValid: verification.idChecksumValid,
    hasImage: Boolean(verification.imagePath),
    reason: verification.reason,
    verifiedAt: verification.verifiedAt,
    createdAt: verification.createdAt,
});
class OcrService {
    static async verifyIdCard(imageBase64, options = {}) {
        const { baseUrl, apiKey } = getOcrConfig();
        const sanitizedImage = stripDataUrlPrefix(imageBase64).trim();
        if (!sanitizedImage) {
            throw new error_handler_1.AppError('imageBase64 is required', 400);
        }
        const formData = new URLSearchParams();
        formData.set('image_base64', sanitizedImage);
        const response = await fetch(`${baseUrl}/api/v1/ocr/id-card`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-API-KEY': apiKey,
            },
            body: formData,
        });
        const payload = (await response.json().catch(() => null));
        if (!payload) {
            throw new error_handler_1.AppError('OCR service returned an invalid response', 502);
        }
        if (!response.ok && response.status >= 500) {
            throw new error_handler_1.AppError(payload.message || payload.error || 'OCR service is unavailable', 502);
        }
        const result = this.mapIdCardVerification(payload);
        const imagePath = result.isThaiIdCard ? await savePrivateIdCardImage(imageBase64, sanitizedImage) : undefined;
        const savedVerification = await this.saveVerificationResult(result, imagePath, options.userId);
        const publicResult = {
            verificationId: result.verificationId,
            isThaiIdCard: result.isThaiIdCard,
            reason: result.reason,
            imagePath: result.imagePath,
            citizenIdMasked: result.citizenIdMasked,
            fullNameTh: result.fullNameTh,
            birthDateTh: result.birthDateTh,
            issueDate: result.issueDate,
            expiryDate: result.expiryDate,
            confidence: result.confidence,
            processingTimeMs: result.processingTimeMs,
            jobId: result.jobId,
        };
        return {
            ...publicResult,
            verificationId: savedVerification.id,
            imagePath,
        };
    }
    static mapIdCardVerification(payload) {
        const data = payload.data ?? {};
        const validation = payload.validation ?? {};
        const citizenId = getStringValue(data.citizen_id) ?? getStringValue(data.id_number);
        const fullNameTh = getStringValue(data.bp_full_name_th) ?? getStringValue(data.th_name);
        const birthDateTh = getStringValue(data.dob_th) ?? getStringValue(data.th_dob);
        const idDetected = payload.id_detected === true;
        const idPresent = validation.id_present === true || Boolean(citizenId);
        const idChecksumValid = validation.id_checksum_valid === true;
        const hasMandatoryData = Boolean(citizenId && fullNameTh && birthDateTh);
        const isThaiIdCard = payload.success === true && idDetected && idPresent && idChecksumValid && hasMandatoryData;
        const normalizedCitizenId = citizenId?.replace(/\D/g, '');
        return {
            isThaiIdCard,
            reason: isThaiIdCard
                ? undefined
                : payload.message || payload.error || 'Unable to verify this image as a Thai ID card',
            citizenIdMasked: normalizedCitizenId ? maskCitizenId(normalizedCitizenId) : undefined,
            citizenIdHash: normalizedCitizenId ? hashCitizenId(normalizedCitizenId) : undefined,
            fullNameTh,
            birthDateTh,
            issueDate: getStringValue(data.issue_date),
            expiryDate: getStringValue(data.expiry_date),
            confidence: {
                idDetected,
                idPresent,
                idChecksumValid,
            },
            processingTimeMs: payload.processing_time_ms,
            jobId: payload.job_id,
        };
    }
    static async saveVerificationResult(result, imagePath, userId) {
        return db_1.prisma.idCardVerification.create({
            data: {
                userId,
                imagePath,
                isThaiIdCard: result.isThaiIdCard,
                citizenIdMasked: result.citizenIdMasked,
                citizenIdHash: result.citizenIdHash,
                fullNameTh: result.fullNameTh,
                birthDateTh: result.birthDateTh,
                issueDate: result.issueDate,
                expiryDate: result.expiryDate,
                idDetected: result.confidence.idDetected,
                idPresent: result.confidence.idPresent,
                idChecksumValid: result.confidence.idChecksumValid,
                reason: result.reason,
                ocrJobId: result.jobId,
                processingTimeMs: result.processingTimeMs,
            },
        });
    }
    static async deleteIdCardVerification(id) {
        const verification = await db_1.prisma.idCardVerification.findUnique({
            where: { id },
            select: {
                id: true,
                imagePath: true,
            },
        });
        if (!verification) {
            throw new error_handler_1.AppError('Id card verification record not found', 404);
        }
        const imageDeleted = await deletePrivateImageIfExists(verification.imagePath);
        await db_1.prisma.idCardVerification.delete({
            where: { id },
        });
        return {
            id,
            imageDeleted,
        };
    }
    static async listIdCardVerifications(page = 1, limit = 20) {
        const safePage = Math.max(1, page);
        const safeLimit = Math.min(Math.max(1, limit), 100);
        const skip = (safePage - 1) * safeLimit;
        const [items, total] = await db_1.prisma.$transaction([
            db_1.prisma.idCardVerification.findMany({
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
            db_1.prisma.idCardVerification.count(),
        ]);
        return {
            items: items.map(toSummary),
            pagination: {
                page: safePage,
                limit: safeLimit,
                total,
                totalPages: Math.ceil(total / safeLimit),
            },
        };
    }
    static async getIdCardVerification(id) {
        const verification = await db_1.prisma.idCardVerification.findUnique({
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
        if (!verification) {
            throw new error_handler_1.AppError('Id card verification record not found', 404);
        }
        return {
            ...toSummary(verification),
            issueDate: verification.issueDate,
            expiryDate: verification.expiryDate,
            ocrJobId: verification.ocrJobId,
            processingTimeMs: verification.processingTimeMs,
        };
    }
    static async getIdCardVerificationImage(id) {
        const verification = await db_1.prisma.idCardVerification.findUnique({
            where: { id },
            select: {
                imagePath: true,
            },
        });
        if (!verification) {
            throw new error_handler_1.AppError('Id card verification record not found', 404);
        }
        if (!verification.imagePath) {
            throw new error_handler_1.AppError('Id card verification image not found', 404);
        }
        const absolutePath = resolvePrivateImagePath(verification.imagePath);
        try {
            await promises_1.default.access(absolutePath);
        }
        catch {
            throw new error_handler_1.AppError('Id card verification image not found', 404);
        }
        return {
            absolutePath,
            contentType: getImageContentType(absolutePath),
        };
    }
}
exports.OcrService = OcrService;
