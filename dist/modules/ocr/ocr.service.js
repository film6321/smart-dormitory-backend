"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OcrService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("../../logger");
const error_handler_1 = require("../../middlewares/error-handler");
const cache_1 = require("../../shared/cache");
const ocr_repository_1 = require("./ocr.repository");
const ocr_queue_1 = require("./ocr.queue");
const normalizeBaseUrl = (url) => url.replace(/\/+$/, '');
const uploadRoot = path_1.default.resolve(process.env.UPLOAD_ROOT || path_1.default.join(process.cwd(), 'uploads/private'));
const privateUploadRoot = path_1.default.join(uploadRoot, 'id-cards');
const privateOcrJobRoot = path_1.default.join(uploadRoot, 'ocr-jobs');
const idCardVerificationListCachePrefix = 'cache:ocr:id-card-verifications';
const ocrCircuit = {
    failureCount: 0,
    openedUntil: 0,
};
const getOcrConfig = () => {
    const baseUrl = process.env.OCR_API_BASE_URL || process.env.OCR_API_URL;
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
const getNumberEnv = (key, fallback) => {
    const value = Number(process.env[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
};
const sleep = (milliseconds) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
});
const ensureOcrCircuitIsClosed = () => {
    if (Date.now() < ocrCircuit.openedUntil) {
        throw new error_handler_1.AppError('OCR service is temporarily unavailable', 503);
    }
};
const recordOcrSuccess = () => {
    ocrCircuit.failureCount = 0;
    ocrCircuit.openedUntil = 0;
};
const recordOcrFailure = () => {
    const threshold = getNumberEnv('OCR_CIRCUIT_FAILURE_THRESHOLD', 5);
    ocrCircuit.failureCount += 1;
    if (ocrCircuit.failureCount >= threshold) {
        const openMs = getNumberEnv('OCR_CIRCUIT_OPEN_MS', 30_000);
        ocrCircuit.openedUntil = Date.now() + openMs;
        logger_1.logger.warn({ openMs }, 'OCR circuit breaker opened');
    }
};
const fetchWithTimeout = async (url, init, timeoutMs) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal,
        });
    }
    finally {
        clearTimeout(timeout);
    }
};
const callOcrIdCardApi = async (baseUrl, apiKey, formData) => {
    ensureOcrCircuitIsClosed();
    const timeoutMs = getNumberEnv('OCR_TIMEOUT_MS', 10_000);
    const retryAttempts = Math.min(getNumberEnv('OCR_RETRY_ATTEMPTS', 2), 5);
    const retryDelayMs = getNumberEnv('OCR_RETRY_DELAY_MS', 250);
    const maxAttempts = retryAttempts + 1;
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const response = await fetchWithTimeout(`${baseUrl}/api/v1/ocr/id-card`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-API-KEY': apiKey,
                },
                body: formData,
            }, timeoutMs);
            const payload = (await response.json().catch(() => null));
            if (!payload) {
                throw new Error('OCR service returned an invalid response');
            }
            if (response.ok || response.status < 500) {
                recordOcrSuccess();
                return { response, payload };
            }
            throw new Error(payload.message || payload.error || 'OCR service is unavailable');
        }
        catch (error) {
            lastError = error;
            if (attempt < maxAttempts) {
                await sleep(retryDelayMs * attempt);
            }
        }
    }
    recordOcrFailure();
    logger_1.logger.warn({ error: lastError }, 'OCR request failed after retries');
    throw new error_handler_1.AppError('OCR service is unavailable', 502);
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
const savePrivateImage = async (root, imageBase64, sanitizedImage) => {
    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const extension = getImageExtension(imageBase64);
    const fileName = `${crypto_1.default.randomUUID()}.${extension}`;
    const directory = path_1.default.join(root, year, month);
    const absolutePath = path_1.default.join(directory, fileName);
    await promises_1.default.mkdir(directory, { recursive: true });
    await promises_1.default.writeFile(absolutePath, Buffer.from(sanitizedImage, 'base64'), { mode: 0o600 });
    return path_1.default.relative(process.cwd(), absolutePath).replace(/\\/g, '/');
};
const savePrivateIdCardImage = async (imageBase64, sanitizedImage) => savePrivateImage(privateUploadRoot, imageBase64, sanitizedImage);
const savePrivateOcrJobImage = async (imageBase64, sanitizedImage) => savePrivateImage(privateOcrJobRoot, imageBase64, sanitizedImage);
const resolvePrivateStoredPath = (imagePath) => {
    const absolutePath = path_1.default.resolve(process.cwd(), imagePath);
    const uploadRootWithSeparator = `${uploadRoot}${path_1.default.sep}`;
    if (absolutePath !== uploadRoot && !absolutePath.startsWith(uploadRootWithSeparator)) {
        throw new error_handler_1.AppError('Stored file path is outside private upload directory', 500);
    }
    return absolutePath;
};
const resolvePrivateImagePath = (imagePath) => {
    const absolutePath = resolvePrivateStoredPath(imagePath);
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
const readPrivateImageAsDataUrl = async (imagePath) => {
    const absolutePath = resolvePrivateStoredPath(imagePath);
    const image = await promises_1.default.readFile(absolutePath);
    return `data:${getImageContentType(absolutePath)};base64,${image.toString('base64')}`;
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
const toOcrJobSummary = (job) => ({
    id: job.id,
    userId: job.userId,
    status: job.status,
    resultVerificationId: job.resultVerificationId,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
});
const invalidateIdCardVerificationListCache = async () => {
    await (0, cache_1.deleteCacheByPattern)(`${idCardVerificationListCachePrefix}:*`);
};
class OcrService {
    static async createIdCardVerificationJob(imageBase64, options = {}) {
        const sanitizedImage = stripDataUrlPrefix(imageBase64).trim();
        if (!sanitizedImage) {
            throw new error_handler_1.AppError('imageBase64 is required', 400);
        }
        const imagePath = await savePrivateOcrJobImage(imageBase64, sanitizedImage);
        const createData = { imagePath };
        if (options.userId)
            createData.user = { connect: { id: options.userId } };
        const job = await ocr_repository_1.OcrRepository.createOcrJob(createData);
        try {
            await (0, ocr_queue_1.enqueueOcrJob)(job.id);
        }
        catch (error) {
            await ocr_repository_1.OcrRepository.updateOcrJob(job.id, {
                status: 'FAILED',
                errorMessage: 'Failed to enqueue OCR job',
                completedAt: new Date(),
            });
            logger_1.logger.warn({ error, jobId: job.id }, 'Failed to enqueue OCR job');
            throw new error_handler_1.AppError('Failed to enqueue OCR job', 503);
        }
        return toOcrJobSummary(job);
    }
    static async getIdCardVerificationJob(jobId) {
        const job = await ocr_repository_1.OcrRepository.findOcrJobById(jobId);
        if (!job) {
            throw new error_handler_1.AppError('OCR job not found', 404);
        }
        return toOcrJobSummary(job);
    }
    static async processIdCardVerificationJob(jobId) {
        const job = await ocr_repository_1.OcrRepository.findOcrJobById(jobId);
        if (!job || job.status !== 'PENDING') {
            return;
        }
        await ocr_repository_1.OcrRepository.updateOcrJob(job.id, {
            status: 'PROCESSING',
            errorMessage: null,
        });
        try {
            const imageBase64 = await readPrivateImageAsDataUrl(job.imagePath);
            const result = await this.verifyIdCard(imageBase64, { userId: job.userId ?? undefined });
            await ocr_repository_1.OcrRepository.updateOcrJob(job.id, { status: 'COMPLETED', resultVerification: { connect: { id: result.verificationId } }, completedAt: new Date() });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown OCR job error';
            await ocr_repository_1.OcrRepository.updateOcrJob(job.id, { status: 'FAILED', errorMessage: message, completedAt: new Date() });
            logger_1.logger.warn({ error, jobId: job.id }, 'OCR job failed');
        }
    }
    static async verifyIdCard(imageBase64, options = {}) {
        const { baseUrl, apiKey } = getOcrConfig();
        const sanitizedImage = stripDataUrlPrefix(imageBase64).trim();
        if (!sanitizedImage) {
            throw new error_handler_1.AppError('imageBase64 is required', 400);
        }
        const formData = new URLSearchParams();
        formData.set('image_base64', sanitizedImage);
        const { response, payload } = await callOcrIdCardApi(baseUrl, apiKey, formData);
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
        const createVerification = {
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
        };
        if (userId)
            createVerification.user = { connect: { id: userId } };
        const verification = await ocr_repository_1.OcrRepository.createIdCardVerification(createVerification);
        await invalidateIdCardVerificationListCache();
        return verification;
    }
    static async deleteIdCardVerification(id) {
        const verification = await ocr_repository_1.OcrRepository.findIdCardVerificationById(id);
        if (!verification) {
            throw new error_handler_1.AppError('Id card verification record not found', 404);
        }
        const imageDeleted = await deletePrivateImageIfExists(verification.imagePath);
        await ocr_repository_1.OcrRepository.deleteIdCardVerification(id);
        await invalidateIdCardVerificationListCache();
        return {
            id,
            imageDeleted,
        };
    }
    static async listIdCardVerifications(page = 1, limit = 20) {
        const safePage = Math.max(1, page);
        const safeLimit = Math.min(Math.max(1, limit), 100);
        const skip = (safePage - 1) * safeLimit;
        const cacheKey = `${idCardVerificationListCachePrefix}:${safePage}:${safeLimit}`;
        const cached = await (0, cache_1.getJsonCache)(cacheKey);
        if (cached) {
            return cached;
        }
        const listResult = await ocr_repository_1.OcrRepository.listIdCardVerifications(safePage, safeLimit);
        const items = listResult.items;
        const total = listResult.total;
        const result = {
            items: items.map(toSummary),
            pagination: {
                page: safePage,
                limit: safeLimit,
                total,
                totalPages: Math.ceil(total / safeLimit),
            },
        };
        await (0, cache_1.setJsonCache)(cacheKey, result, 30);
        return result;
    }
    static async getIdCardVerification(id) {
        const verification = await ocr_repository_1.OcrRepository.findIdCardVerificationById(id);
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
        const verification = await ocr_repository_1.OcrRepository.findIdCardVerificationById(id);
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
