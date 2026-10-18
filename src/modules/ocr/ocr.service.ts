import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../logger';
import { AppError } from '../../middlewares/error-handler';
import { deleteCacheByPattern, getJsonCache, setJsonCache } from '../../shared/cache';
import { OcrRepository } from './ocr.repository';
import {
  DeleteIdCardVerificationResult,
  CreateOcrJobResult,
  IdCardVerificationDetail,
  IdCardVerificationImageResult,
  IdCardVerificationSummary,
  ListIdCardVerificationsResult,
  OcrJobSummary,
  OcrIdCardResponse,
  VerifyIdCardOptions,
  VerifyIdCardResult,
} from './ocr.types';
import { enqueueOcrJob } from './ocr.queue';
import { Prisma } from '@prisma/client';
import { calculateAge } from '../../shared/date-utils';
import { isRecord } from '../../shared/input';

const isOptionalStringFields = (value: Record<string, unknown>, fields: string[]): boolean =>
  fields.every((field) => value[field] === undefined || value[field] === null || typeof value[field] === 'string');

const parseOcrResponse = (value: unknown): OcrIdCardResponse | null => {
  if (!isRecord(value)) return null;
  if (!isOptionalStringFields(value, [
    'message', 'error', 'job_id', 'citizen_id', 'id_number', 'birth_date', 'birthDate',
    'date_of_birth', 'address', 'address_th', 'th_address',
  ])) return null;
  if (value.success !== undefined && typeof value.success !== 'boolean') return null;
  if (value.id_detected !== undefined && typeof value.id_detected !== 'boolean') return null;
  if (value.processing_time_ms !== undefined
    && (typeof value.processing_time_ms !== 'number' || !Number.isFinite(value.processing_time_ms) || value.processing_time_ms < 0)) return null;
  if (value.data !== undefined) {
    if (!isRecord(value.data) || !isOptionalStringFields(value.data, [
      'citizen_id', 'id_number', 'th_name', 'bp_full_name_th', 'th_dob', 'dob_th', 'address',
      'address_th', 'th_address', 'issue_date', 'expiry_date',
    ])) return null;
  }
  if (value.validation !== undefined) {
    if (!isRecord(value.validation)
      || value.validation.id_present !== undefined && typeof value.validation.id_present !== 'boolean'
      || value.validation.id_checksum_valid !== undefined && typeof value.validation.id_checksum_valid !== 'boolean') return null;
  }
  return value as OcrIdCardResponse;
};

const normalizeBaseUrl = (url: string) => url.replace(/\/+$/, '');
const uploadRoot = path.resolve(process.env.UPLOAD_ROOT || path.join(process.cwd(), 'uploads/private'));
const privateUploadRoot = path.join(uploadRoot, 'id-cards');
const privateOcrJobRoot = path.join(uploadRoot, 'ocr-jobs');
const idCardVerificationListCachePrefix = 'cache:ocr:id-card-verifications';

const ocrCircuit = {
  failureCount: 0,
  openedUntil: 0,
};

interface InternalVerifyIdCardResult extends VerifyIdCardResult {
  citizenId?: string;
  citizenIdHash?: string;
}

const getOcrConfig = () => {
  const baseUrl = process.env.OCR_API_BASE_URL || process.env.OCR_API_URL;
  const apiKey = process.env.OCR_API_KEY;

  if (!baseUrl) {
    throw new AppError('OCR_API_BASE_URL is not configured', 500);
  }

  if (!apiKey) {
    throw new AppError('OCR_API_KEY is not configured', 500);
  }

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    apiKey,
  };
};

const getNumberEnv = (key: string, fallback: number): number => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const ensureOcrCircuitIsClosed = (): void => {
  if (Date.now() < ocrCircuit.openedUntil) {
    throw new AppError('OCR service is temporarily unavailable', 503);
  }
};

const recordOcrSuccess = (): void => {
  ocrCircuit.failureCount = 0;
  ocrCircuit.openedUntil = 0;
};

const recordOcrFailure = (): void => {
  const threshold = getNumberEnv('OCR_CIRCUIT_FAILURE_THRESHOLD', 5);
  ocrCircuit.failureCount += 1;

  if (ocrCircuit.failureCount >= threshold) {
    const openMs = getNumberEnv('OCR_CIRCUIT_OPEN_MS', 30_000);
    ocrCircuit.openedUntil = Date.now() + openMs;
    logger.warn({ openMs }, 'OCR circuit breaker opened');
  }
};

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const callOcrIdCardApi = async (
  baseUrl: string,
  apiKey: string,
  formData: URLSearchParams,
): Promise<{ response: Response; payload: OcrIdCardResponse }> => {
  ensureOcrCircuitIsClosed();

  const timeoutMs = getNumberEnv('OCR_TIMEOUT_MS', 10_000);
  const retryAttempts = Math.min(getNumberEnv('OCR_RETRY_ATTEMPTS', 2), 5);
  const retryDelayMs = getNumberEnv('OCR_RETRY_DELAY_MS', 250);
  const maxAttempts = retryAttempts + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        `${baseUrl}/api/v1/ocr/id-card`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-API-KEY': apiKey,
          },
          body: formData,
        },
        timeoutMs,
      );
      const payload = parseOcrResponse(await response.json().catch(() => null));

      if (!payload) {
        throw new Error('OCR service returned an invalid response');
      }

      if (response.ok || response.status < 500) {
        recordOcrSuccess();
        return { response, payload };
      }

      throw new Error(payload.message || payload.error || 'OCR service is unavailable');
    } catch (error) {
      lastError = error;

      if (attempt < maxAttempts) {
        await sleep(retryDelayMs * attempt);
      }
    }
  }

  recordOcrFailure();
  logger.warn({ error: lastError }, 'OCR request failed after retries');
  throw new AppError('OCR service is unavailable', 502);
};

const getStringValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed && !/^[\s\-–—_*]+$/u.test(trimmed) ? trimmed : undefined;
};


const stripDataUrlPrefix = (imageBase64: string): string => {
  const commaIndex = imageBase64.indexOf(',');
  return imageBase64.startsWith('data:') && commaIndex >= 0
    ? imageBase64.slice(commaIndex + 1)
    : imageBase64;
};

const getImageExtension = (imageBase64: string): string => {
  const match = imageBase64.match(/^data:image\/(png|jpe?g|webp);base64,/i);
  const extension = match?.[1]?.toLowerCase();

  if (extension === 'jpeg') {
    return 'jpg';
  }

  return extension ?? 'jpg';
};

const maskCitizenId = (citizenId: string): string => {
  const normalized = citizenId.replace(/\D/g, '');

  if (normalized.length < 5) {
    return '*'.repeat(normalized.length);
  }

  return `${normalized.slice(0, 3)}${'*'.repeat(Math.max(normalized.length - 5, 0))}${normalized.slice(-2)}`;
};

const hashCitizenId = (citizenId: string): string => crypto.createHash('sha256').update(citizenId).digest('hex');

const savePrivateImage = async (root: string, imageBase64: string, sanitizedImage: string): Promise<string> => {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const extension = getImageExtension(imageBase64);
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const directory = path.join(root, year, month);
  const absolutePath = path.join(directory, fileName);

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(absolutePath, Buffer.from(sanitizedImage, 'base64'), { mode: 0o600 });

  return path.relative(process.cwd(), absolutePath).replace(/\\/g, '/');
};

const savePrivateIdCardImage = async (imageBase64: string, sanitizedImage: string): Promise<string> =>
  savePrivateImage(privateUploadRoot, imageBase64, sanitizedImage);

const savePrivateOcrJobImage = async (imageBase64: string, sanitizedImage: string): Promise<string> =>
  savePrivateImage(privateOcrJobRoot, imageBase64, sanitizedImage);

const resolvePrivateStoredPath = (imagePath: string): string => {
  const absolutePath = path.resolve(process.cwd(), imagePath);
  const uploadRootWithSeparator = `${uploadRoot}${path.sep}`;

  if (absolutePath !== uploadRoot && !absolutePath.startsWith(uploadRootWithSeparator)) {
    throw new AppError('Stored file path is outside private upload directory', 500);
  }

  return absolutePath;
};

const resolvePrivateImagePath = (imagePath: string): string => {
  const absolutePath = resolvePrivateStoredPath(imagePath);
  const privateRootWithSeparator = `${privateUploadRoot}${path.sep}`;

  if (absolutePath !== privateUploadRoot && !absolutePath.startsWith(privateRootWithSeparator)) {
    throw new AppError('Stored image path is outside private upload directory', 500);
  }

  return absolutePath;
};

const deletePrivateImageIfExists = async (imagePath?: string | null): Promise<boolean> => {
  if (!imagePath) {
    return false;
  }

  const absolutePath = resolvePrivateImagePath(imagePath);

  try {
    await fs.unlink(absolutePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }

    throw error;
  }
};

const getImageContentType = (imagePath: string): string => {
  const extension = path.extname(imagePath).toLowerCase();

  if (extension === '.png') {
    return 'image/png';
  }

  if (extension === '.webp') {
    return 'image/webp';
  }

  return 'image/jpeg';
};

const readPrivateImageAsDataUrl = async (imagePath: string): Promise<string> => {
  const absolutePath = resolvePrivateStoredPath(imagePath);
  const image = await fs.readFile(absolutePath);

  return `data:${getImageContentType(absolutePath)};base64,${image.toString('base64')}`;
};

const toSummary = (verification: {
  id: number;
  userId: number | null;
  imagePath: string | null;
  isThaiIdCard: boolean;
  citizenIdMasked: string | null;
  fullNameTh: string | null;
  birthDateTh: string | null;
  idDetected: boolean;
  idPresent: boolean;
  idChecksumValid: boolean;
  reason: string | null;
  verifiedAt: Date;
  createdAt: Date;
}): IdCardVerificationSummary => ({
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

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const decodeCachedVerifications = (value: unknown): ListIdCardVerificationsResult | undefined => {
  if (!isRecord(value) || !Array.isArray(value.items) || !isRecord(value.pagination)) return undefined;
  const pagination = value.pagination;
  if (!isNonNegativeInteger(pagination.page) || !isNonNegativeInteger(pagination.limit)
    || !isNonNegativeInteger(pagination.total) || !isNonNegativeInteger(pagination.totalPages)) return undefined;
  const items: IdCardVerificationSummary[] = [];
  for (const item of value.items) {
    if (!isRecord(item)
      || typeof item.id !== 'number' || !Number.isSafeInteger(item.id)
      || item.userId !== null && typeof item.userId !== 'number'
      || typeof item.isThaiIdCard !== 'boolean'
      || item.citizenIdMasked !== null && typeof item.citizenIdMasked !== 'string'
      || item.fullNameTh !== null && typeof item.fullNameTh !== 'string'
      || item.birthDateTh !== null && typeof item.birthDateTh !== 'string'
      || typeof item.idDetected !== 'boolean' || typeof item.idPresent !== 'boolean'
      || typeof item.idChecksumValid !== 'boolean' || typeof item.hasImage !== 'boolean'
      || item.reason !== null && typeof item.reason !== 'string'
      || typeof item.verifiedAt !== 'string' || !Number.isFinite(Date.parse(item.verifiedAt))
      || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))) return undefined;
    items.push({
      id: item.id,
      userId: item.userId,
      isThaiIdCard: item.isThaiIdCard,
      citizenIdMasked: item.citizenIdMasked,
      fullNameTh: item.fullNameTh,
      birthDateTh: item.birthDateTh,
      idDetected: item.idDetected,
      idPresent: item.idPresent,
      idChecksumValid: item.idChecksumValid,
      hasImage: item.hasImage,
      reason: item.reason,
      verifiedAt: new Date(item.verifiedAt),
      createdAt: new Date(item.createdAt),
    });
  }
  return { items, pagination: { page: pagination.page, limit: pagination.limit, total: pagination.total, totalPages: pagination.totalPages } };
};

const toOcrJobSummary = (job: {
  id: string;
  userId: number | null;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  resultVerificationId: number | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}): OcrJobSummary => ({
  id: job.id,
  userId: job.userId,
  status: job.status,
  resultVerificationId: job.resultVerificationId,
  errorMessage: job.errorMessage,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  completedAt: job.completedAt,
});

const invalidateIdCardVerificationListCache = async (): Promise<void> => {
  await deleteCacheByPattern(`${idCardVerificationListCachePrefix}:*`);
};

export class OcrService {
  static async createIdCardVerificationJob(
    imageBase64: string,
    options: VerifyIdCardOptions = {},
  ): Promise<CreateOcrJobResult> {
    const sanitizedImage = stripDataUrlPrefix(imageBase64).trim();

    if (!sanitizedImage) {
      throw new AppError('imageBase64 is required', 400);
    }

    const imagePath = await savePrivateOcrJobImage(imageBase64, sanitizedImage);
    const createData: Prisma.OcrJobCreateInput = {
      imagePath,
      ...(options.userId ? { user: { connect: { id: options.userId } } } : {}),
    };
    const job = await OcrRepository.createOcrJob(createData);

    try {
      await enqueueOcrJob(job.id);
    } catch (error) {
      await OcrRepository.updateOcrJob(job.id, {
        status: 'FAILED',
        errorMessage: 'Failed to enqueue OCR job',
        completedAt: new Date(),
      });
      logger.warn({ error, jobId: job.id }, 'Failed to enqueue OCR job');
      throw new AppError('Failed to enqueue OCR job', 503);
    }

    return toOcrJobSummary(job);
  }

  static async getIdCardVerificationJob(jobId: string): Promise<OcrJobSummary> {
    const job = await OcrRepository.findOcrJobById(jobId);

    if (!job) {
      throw new AppError('OCR job not found', 404);
    }

    return toOcrJobSummary(job);
  }

  static async processIdCardVerificationJob(jobId: string): Promise<void> {
    const job = await OcrRepository.findOcrJobById(jobId);

    if (!job || job.status !== 'PENDING') {
      return;
    }

    await OcrRepository.updateOcrJob(job.id, {
      status: 'PROCESSING',
      errorMessage: null,
    });

    try {
      const imageBase64 = await readPrivateImageAsDataUrl(job.imagePath);
      const result = await this.verifyIdCard(imageBase64, { userId: job.userId ?? undefined });

      await OcrRepository.updateOcrJob(job.id, { status: 'COMPLETED', resultVerification: { connect: { id: result.verificationId } }, completedAt: new Date() });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown OCR job error';
      await OcrRepository.updateOcrJob(job.id, { status: 'FAILED', errorMessage: message, completedAt: new Date() });
      logger.warn({ error, jobId: job.id }, 'OCR job failed');
    }
  }

  static async verifyIdCard(imageBase64: string, options: VerifyIdCardOptions = {}): Promise<VerifyIdCardResult> {
    const { baseUrl, apiKey } = getOcrConfig();
    const sanitizedImage = stripDataUrlPrefix(imageBase64).trim();

    if (!sanitizedImage) {
      throw new AppError('imageBase64 is required', 400);
    }

    const formData = new URLSearchParams();
    formData.set('image_base64', sanitizedImage);

    const { response, payload } = await callOcrIdCardApi(baseUrl, apiKey, formData);

    if (!response.ok && response.status >= 500) {
      throw new AppError(payload.message || payload.error || 'OCR service is unavailable', 502);
    }

    const result = this.mapIdCardVerification(payload);
    const imagePath = result.confidence.idDetected ? await savePrivateIdCardImage(imageBase64, sanitizedImage) : undefined;
    const savedVerification = await this.saveVerificationResult(result, imagePath, options.userId);
    const publicResult: VerifyIdCardResult = {
      verificationId: result.verificationId,
      isThaiIdCard: result.isThaiIdCard,
      reason: result.reason,
      citizenId: result.citizenId,
      address: result.address,
      age: result.age,
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

  private static mapIdCardVerification(payload: OcrIdCardResponse): InternalVerifyIdCardResult {
    const data = {
      ...(payload.data ?? {}),
      citizen_id: payload.citizen_id ?? payload.id_number ?? payload.data?.citizen_id ?? payload.data?.id_number,
      dob_th: payload.birth_date ?? payload.birthDate ?? payload.date_of_birth ?? payload.data?.dob_th ?? payload.data?.th_dob,
      address: payload.address ?? payload.address_th ?? payload.th_address ?? payload.data?.address ?? payload.data?.address_th ?? payload.data?.th_address,
    };
    const validation = payload.validation ?? {};
    const citizenId = getStringValue(data.citizen_id) ?? getStringValue(data.id_number);
    const fullNameTh = getStringValue(data.bp_full_name_th) ?? getStringValue(data.th_name);
    const birthDateTh = getStringValue(data.dob_th) ?? getStringValue(data.th_dob);
    const address = getStringValue(data.address) ?? getStringValue(data.address_th) ?? getStringValue(data.th_address);
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
      citizenId: normalizedCitizenId,
      address,
      age: calculateAge(birthDateTh),
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
      jobId: payload.job_id ?? undefined,
    };
  }

  private static async saveVerificationResult(
    result: InternalVerifyIdCardResult,
    imagePath?: string,
    userId?: number,
  ) {
    const createVerification: Prisma.IdCardVerificationCreateInput = {
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
      ...(userId ? { user: { connect: { id: userId } } } : {}),
    };

    const verification = await OcrRepository.createIdCardVerification(createVerification);

    await invalidateIdCardVerificationListCache();

    return verification;
  }

  static async deleteIdCardVerification(id: number): Promise<DeleteIdCardVerificationResult> {
    const verification = await OcrRepository.findIdCardVerificationById(id);

    if (!verification) {
      throw new AppError('Id card verification record not found', 404);
    }

    // Delete the row first: a rejected delete must never remove its evidence image.
    await OcrRepository.deleteIdCardVerification(id);

    const imageDeleted = await deletePrivateImageIfExists(verification.imagePath);

    await invalidateIdCardVerificationListCache();

    return {
      id,
      imageDeleted,
    };
  }

  static async listIdCardVerifications(page = 1, limit = 20): Promise<ListIdCardVerificationsResult> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const cacheKey = `${idCardVerificationListCachePrefix}:${safePage}:${safeLimit}`;
    const cached = await getJsonCache(cacheKey, decodeCachedVerifications);

    if (cached) {
      return cached;
    }

    const listResult = await OcrRepository.listIdCardVerifications(safePage, safeLimit);
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

    await setJsonCache(cacheKey, result, 30);

    return result;
  }

  static async getIdCardVerification(id: number): Promise<IdCardVerificationDetail> {
    const verification = await OcrRepository.findIdCardVerificationById(id);

    if (!verification) {
      throw new AppError('Id card verification record not found', 404);
    }

    return {
      ...toSummary(verification),
      issueDate: verification.issueDate,
      expiryDate: verification.expiryDate,
      ocrJobId: verification.ocrJobId,
      processingTimeMs: verification.processingTimeMs,
    };
  }

  static async getIdCardVerificationImage(id: number): Promise<IdCardVerificationImageResult> {
    const verification = await OcrRepository.findIdCardVerificationById(id);

    if (!verification) {
      throw new AppError('Id card verification record not found', 404);
    }

    if (!verification.imagePath) {
      throw new AppError('Id card verification image not found', 404);
    }

    const absolutePath = resolvePrivateImagePath(verification.imagePath);

    try {
      await fs.access(absolutePath);
    } catch {
      throw new AppError('Id card verification image not found', 404);
    }

    return {
      absolutePath,
      contentType: getImageContentType(absolutePath),
    };
  }
}
