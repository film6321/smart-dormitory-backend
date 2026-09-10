"use strict";
/// <reference lib="dom" />
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FaceVerificationService = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const db_1 = require("../../database/db");
const error_handler_1 = require("../../middlewares/error-handler");
const logger_1 = require("../../logger");
const UPLOAD_DIR = path_1.default.join(process.cwd(), 'uploads', 'face-photo');
const db = db_1.prisma;
class FaceVerificationService {
    static DEFAULT_DETECTION_INTERVAL = 4;
    static resolveDetectionInterval(interval) {
        if (interval === undefined || interval === null || interval === '') {
            return this.DEFAULT_DETECTION_INTERVAL;
        }
        const parsed = typeof interval === 'number' ? interval : Number(interval);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return this.DEFAULT_DETECTION_INTERVAL;
        }
        return Math.floor(parsed);
    }
    static shouldProcessFrame(frameIndex, interval) {
        return frameIndex % interval === 0;
    }
    /**
     * Registers a face photo by saving it to disk and recording it in FaceEnrollmentPhoto
     * and forwarding the photo to the Python Face Recognition API for embedding extraction.
     */
    static async registerFace(userId, fileBuffer, mimeType, fileName) {
        logger_1.logger.info({ userId, fileName }, 'Registering face photo, saving pending file to disk');
        // 1. Determine if it is a User or a Visitor
        const userExists = await db.user.findUnique({
            where: { id: userId },
            select: { id: true },
        });
        let visitorId = null;
        let actualUserId = userId;
        if (!userExists) {
            const visitorExists = await db.visitor.findUnique({ where: { id: userId } });
            if (visitorExists) {
                visitorId = userId;
                actualUserId = null;
            }
            else {
                throw new error_handler_1.AppError('User or Visitor not found for the provided ID', 404);
            }
        }
        // 2. Save physical image to disk under uploads/face-photo/
        try {
            await promises_1.default.mkdir(UPLOAD_DIR, { recursive: true });
            const ext = path_1.default.extname(fileName) || '.jpg';
            const cleanFileName = `${actualUserId ? 'user' : 'visitor'}_${userId}_${Date.now()}${ext}`;
            const fullPath = path_1.default.join(UPLOAD_DIR, cleanFileName);
            await promises_1.default.writeFile(fullPath, fileBuffer);
            const relativePath = path_1.default.join('uploads', 'face-photo', cleanFileName);
            // 3. Create metadata record in FaceEnrollmentPhoto
            const photo = await db.faceEnrollmentPhoto.create({
                data: {
                    userId: actualUserId,
                    visitorId: visitorId,
                    photoPath: relativePath,
                },
            });
            // 4. Forward photo to external Python Face Recognition API if configured
            await this.forwardRegisterToExternalApi(userId, fileBuffer, mimeType, cleanFileName);
            return {
                id: photo.id,
                user_id: userId,
                model_name: 'buffalo_l',
                embedding_version: 'v1',
                created_at: photo.createdAt.toISOString(),
                updated_at: photo.createdAt.toISOString(),
            };
        }
        catch (error) {
            if (error instanceof error_handler_1.AppError)
                throw error;
            logger_1.logger.error({ error, userId }, 'Failed to save register face photo');
            throw new error_handler_1.AppError('Failed to register face template', 500);
        }
    }
    /**
     * Helper to forward face registration to the external Python Face API
     */
    static async forwardRegisterToExternalApi(userId, fileBuffer, mimeType, fileName) {
        const rawUrl = process.env.FACE_API_URL?.trim() || 'http://127.0.0.1:8000';
        const baseUrl = rawUrl.replace(/\/+$/u, '').replace(/\/api\/v1\/?$/u, '').replace(/\/faces\/?$/u, '');
        const endpoint = `${baseUrl}/api/v1/faces/register`;
        const apiKey = process.env.FACE_API_KEY?.trim();
        if (!apiKey) {
            throw new error_handler_1.AppError('FACE_API_KEY is not configured', 500);
        }
        try {
            if (typeof fetch !== 'function')
                return;
            const fileArrayBuffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);
            const formData = new FormData();
            formData.append('user_id', String(userId));
            formData.append('file', new Blob([fileArrayBuffer], { type: mimeType }), fileName);
            const response = await fetch(endpoint, {
                method: 'POST',
                body: formData,
                headers: {
                    'X-API-Key': apiKey,
                },
                signal: AbortSignal.timeout(5000),
            });
            if (response.ok) {
                logger_1.logger.info({ userId, endpoint }, 'Successfully forwarded face registration to Python API');
            }
            else {
                await response.arrayBuffer();
                logger_1.logger.warn({ userId, status: response.status }, 'External Face API register returned non-200');
            }
        }
        catch (error) {
            logger_1.logger.warn({ userId, error }, 'Failed to forward face registration to external Face API (will proceed with local disk copy)');
        }
    }
    /**
     * Normalizes the Face API endpoint URL
     */
    static normalizeFaceApiUrl() {
        const rawUrl = process.env.FACE_API_URL?.trim() || 'http://127.0.0.1:8000';
        const baseUrl = rawUrl.replace(/\/+$/u, '');
        if (baseUrl.endsWith('/api/v1/faces/verify') || baseUrl.endsWith('/faces/verify')) {
            return baseUrl;
        }
        if (baseUrl.endsWith('/api/v1')) {
            return `${baseUrl}/faces/verify`;
        }
        return `${baseUrl}/api/v1/faces/verify`;
    }
    /**
     * Safe fallback for when Face API is unreachable or returns invalid data.
     * STRICT SECURITY: Always defaults to NOT_MATCHED (matched: false) to prevent unauthorized access.
     */
    static createMockFaceVerificationResult(_fileBuffer, _fileName, _threshold) {
        return {
            matched: false,
            user_id: null,
            similarity: 0.1,
            processing_time_ms: 50,
            message: 'Face did not match registered templates',
        };
    }
    static async callExternalFaceApi(fileBuffer, mimeType, fileName, threshold) {
        const endpoint = this.normalizeFaceApiUrl();
        const apiKey = process.env.FACE_API_KEY?.trim();
        if (!apiKey) {
            throw new error_handler_1.AppError('FACE_API_KEY is not configured', 500);
        }
        if (typeof fetch !== 'function') {
            throw new error_handler_1.AppError('Runtime fetch API is not available', 500);
        }
        try {
            const fileArrayBuffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);
            const formData = new FormData();
            formData.append('file', new Blob([fileArrayBuffer], { type: mimeType }), fileName);
            if (threshold !== undefined) {
                formData.append('threshold', String(threshold));
            }
            const response = await fetch(endpoint, {
                method: 'POST',
                body: formData,
                headers: {
                    'X-API-Key': apiKey,
                },
                signal: AbortSignal.timeout(4000),
            });
            if (!response.ok) {
                await response.arrayBuffer();
                logger_1.logger.warn({ endpoint, status: response.status, fileName }, 'Face API returned non-ok status');
                return this.createMockFaceVerificationResult(fileBuffer, fileName, threshold);
            }
            const result = await response.json();
            if (typeof result !== 'object' || result === null) {
                throw new error_handler_1.AppError('Face recognition service returned invalid JSON', 502);
            }
            const matched = Boolean(result.matched);
            const matchedUserId = result.user_id !== undefined && result.user_id !== null ? Number(result.user_id) : null;
            let userName = result.message;
            // If matched, lookup real user name from DB
            if (matched && matchedUserId) {
                try {
                    const user = await db.user.findUnique({
                        where: { id: matchedUserId },
                        select: { id: true, username: true, email: true },
                    });
                    if (user) {
                        userName = user.username || user.email || `User #${user.id}`;
                    }
                    else {
                        const visitor = await db.visitor.findUnique({ where: { id: matchedUserId } });
                        if (visitor) {
                            userName = visitor.guestName || `Visitor #${visitor.id}`;
                        }
                    }
                }
                catch {
                    // ignore db lookup failure
                }
            }
            return {
                matched,
                user_id: matchedUserId,
                similarity: Number(result.similarity ?? 0),
                processing_time_ms: Number(result.processing_time_ms ?? 0),
                message: matched ? (userName || 'Face matched successfully') : 'Face did not match registered templates',
            };
        }
        catch (error) {
            logger_1.logger.warn({ fileName, error }, 'External Face API call failed or timed out; safe deny fallback applied');
            return this.createMockFaceVerificationResult(fileBuffer, fileName, threshold);
        }
    }
    static async verifyFace(fileBuffer, mimeType, fileName, threshold) {
        const start = Date.now();
        try {
            const data = await this.callExternalFaceApi(fileBuffer, mimeType, fileName, threshold);
            const elapsed = Date.now() - start;
            await this.saveLog(data.user_id ?? undefined, data.similarity, data.matched ? 'MATCHED' : 'NOT_MATCHED', elapsed);
            return data;
        }
        catch (error) {
            if (error instanceof error_handler_1.AppError) {
                throw error;
            }
            logger_1.logger.error({ error, fileName }, 'Face verification error via external service');
            throw new error_handler_1.AppError('Face recognition service unavailable', 502);
        }
    }
    static async saveLog(userId, similarity, status, durationMs) {
        try {
            await db.accessLog.create({
                data: {
                    userId: userId ?? undefined,
                    method: 'FACE_VERIFY',
                    path: status,
                    ip: 'BACKEND_FACE_VERIFY',
                    duration: Math.round(durationMs),
                },
            });
        }
        catch (err) {
            logger_1.logger.warn({ err, userId, similarity, status, durationMs }, 'Failed to persist face verification log');
        }
    }
    /**
     * Retrieves face embedding details.
     */
    static async getFaceTemplate(templateId) {
        const embedding = await db.faceEmbedding.findUnique({
            where: { id: templateId },
        });
        if (!embedding) {
            throw new error_handler_1.AppError('Template not found', 404);
        }
        const userId = embedding.userId || embedding.visitorId || 0;
        return {
            id: embedding.id,
            user_id: userId,
            model_name: embedding.modelVersion,
            embedding_version: 'v1',
            created_at: embedding.createdAt.toISOString(),
            updated_at: embedding.updatedAt.toISOString(),
        };
    }
    /**
     * Updates face photo for enrollment.
     */
    static async updateFaceTemplate(templateId, fileBuffer, mimeType, fileName) {
        const existing = await db.faceEmbedding.findUnique({
            where: { id: templateId },
        });
        if (!existing) {
            throw new error_handler_1.AppError('Template not found', 404);
        }
        const userId = existing.userId || existing.visitorId || 0;
        return this.registerFace(userId, fileBuffer, mimeType, fileName);
    }
    /**
     * Deletes face template.
     */
    static async deleteFaceTemplate(templateId) {
        try {
            await db.faceEmbedding.delete({
                where: { id: templateId },
            });
            return { success: true, message: 'Face template deleted successfully' };
        }
        catch {
            throw new error_handler_1.AppError('Face template not found', 404);
        }
    }
    // ── C# Edge integrations ──
    /**
     * Sync active face embeddings (since optional date)
     */
    static async getEmbeddings(since) {
        const whereClause = {};
        if (since) {
            const parsedDate = new Date(since);
            if (!Number.isNaN(parsedDate.getTime())) {
                whereClause.updatedAt = { gt: parsedDate };
            }
        }
        const embeddings = await db.faceEmbedding.findMany({
            where: whereClause,
            include: {
                user: {
                    select: {
                        id: true,
                        role: true,
                    }
                },
                visitor: true,
            },
        });
        const data = embeddings.reduce((acc, current) => {
            const studentCode = current.userId
                ? `user_${current.userId}`
                : `visitor_${current.visitorId}`;
            let group = acc.find((item) => item.student_code === studentCode);
            if (!group) {
                group = {
                    student_code: studentCode,
                    model_version: current.modelVersion,
                    vectors: [],
                };
                acc.push(group);
            }
            group.vectors.push(current.vector);
            return acc;
        }, []);
        return {
            data,
            synced_at: new Date().toISOString(),
        };
    }
    /**
     * List pending enrollment photos Grouped by User/Visitor
     */
    static async getPendingEnrollments() {
        // Get all FaceEnrollmentPhotos where the User or Visitor has no FaceEmbeddings yet
        const pendingPhotos = await db.faceEnrollmentPhoto.findMany({
            where: {
                OR: [
                    {
                        user: {
                            faceEmbeddings: {
                                none: {},
                            },
                        },
                    },
                    {
                        visitor: {
                            faceEmbeddings: {
                                none: {},
                            },
                        },
                    },
                ],
            },
            include: {
                user: {
                    select: {
                        id: true,
                        role: true,
                    }
                },
                visitor: true,
            },
        });
        const grouped = pendingPhotos.reduce((acc, photo) => {
            const key = photo.userId ? `user_${photo.userId}` : `visitor_${photo.visitorId}`;
            const studentId = photo.userId ? photo.userId : (photo.visitorId ? photo.visitorId + 1000000 : 0);
            const studentCode = key;
            if (!acc.has(key)) {
                acc.set(key, {
                    student_id: studentId,
                    student_code: studentCode,
                    photos: [],
                });
            }
            acc.get(key)?.photos.push({
                id: photo.id,
                url: `enrollment/photo/${photo.id}`,
            });
            return acc;
        }, new Map());
        return {
            data: Array.from(grouped.values()),
        };
    }
    /**
     * Retrieve physical path of enrollment photo
     */
    static async getEnrollmentPhoto(photoId) {
        const photo = await db.faceEnrollmentPhoto.findUnique({
            where: { id: photoId },
        });
        if (!photo) {
            throw new error_handler_1.AppError('Photo not found', 404);
        }
        const fullPath = path_1.default.resolve(process.cwd(), photo.photoPath);
        return fullPath;
    }
    /**
     * Store embeddings computed by C# Edge client
     */
    static async storeEmbeddings(studentId, modelVersion, vectors, qualityScores) {
        let userId = null;
        let visitorId = null;
        if (studentId >= 1000000) {
            visitorId = studentId - 1000000;
            const visitorExists = await db.visitor.findUnique({ where: { id: visitorId } });
            if (!visitorExists) {
                throw new error_handler_1.AppError('Visitor not found', 404);
            }
        }
        else {
            userId = studentId;
            const userExists = await db.user.findUnique({
                where: { id: userId },
                select: { id: true },
            });
            if (!userExists) {
                throw new error_handler_1.AppError('User not found', 404);
            }
        }
        let storedCount = 0;
        for (let i = 0; i < vectors.length; i++) {
            const vector = vectors[i];
            const score = qualityScores ? qualityScores[i] : null;
            await db.faceEmbedding.create({
                data: {
                    userId,
                    visitorId,
                    vector,
                    modelVersion,
                    qualityScore: score,
                },
            });
            storedCount++;
        }
        logger_1.logger.info({ studentId, storedCount, modelVersion }, 'Successfully stored face embeddings from Edge');
        return storedCount;
    }
    /**
     * Log real-time scan from FaceGate.Edge
     */
    static async recordScan(studentCode, direction, confidence, scannedAt, deviceCode, _snapshotBase64) {
        logger_1.logger.info({ studentCode, direction, deviceCode }, 'Face scan event received from FaceGate.Edge');
        const timestamp = new Date(scannedAt);
        if (studentCode.startsWith('user_')) {
            const userId = Number(studentCode.replace('user_', ''));
            const user = await db.user.findUnique({
                where: { id: userId },
                select: { id: true, username: true, email: true },
            });
            if (!user) {
                throw new error_handler_1.AppError('User not found', 404);
            }
            // Record in AccessLog
            await db.accessLog.create({
                data: {
                    userId: user.id,
                    method: 'FACE_GATE',
                    path: direction,
                    ip: deviceCode || 'EDGE_DEVICE',
                    duration: Math.round(confidence * 100),
                    createdAt: timestamp,
                },
            });
            return {
                status: 'ok',
                action: direction === 'IN' ? 'checkin' : 'checkout',
                student: {
                    code: studentCode,
                    name: user.username || user.email || 'Resident',
                    room: 'Resident',
                },
            };
        }
        else if (studentCode.startsWith('visitor_')) {
            const visitorId = Number(studentCode.replace('visitor_', ''));
            const visitor = await db.visitor.findUnique({ where: { id: visitorId } });
            if (!visitor) {
                throw new error_handler_1.AppError('Visitor not found', 404);
            }
            // Update visitor status
            const nextStatus = direction === 'IN' ? 'CHECKED_IN' : 'CHECKED_OUT';
            await db.visitor.update({
                where: { id: visitor.id },
                data: {
                    status: nextStatus,
                    checkedInAt: direction === 'IN' ? timestamp : visitor.checkedInAt,
                    checkedOutAt: direction === 'OUT' ? timestamp : visitor.checkedOutAt,
                },
            });
            // Write VisitorLog
            await db.visitorLog.create({
                data: {
                    visitorId: visitor.id,
                    eventType: direction === 'IN' ? 'CHECK_IN' : 'CHECK_OUT',
                    note: `Scanned on device: ${deviceCode || 'N/A'} (confidence: ${confidence})`,
                    createdAt: timestamp,
                },
            });
            return {
                status: 'ok',
                action: direction === 'IN' ? 'checkin' : 'checkout',
                student: {
                    code: studentCode,
                    name: visitor.guestName,
                    room: 'Visitor',
                },
            };
        }
        else {
            throw new error_handler_1.AppError(`Invalid student_code format: ${studentCode}`, 400);
        }
    }
}
exports.FaceVerificationService = FaceVerificationService;
