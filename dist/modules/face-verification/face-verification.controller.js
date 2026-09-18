"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FaceVerificationController = void 0;
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const db_1 = require("../../database/db");
const api_response_1 = require("../../shared/api-response");
const face_verification_service_1 = require("./face-verification.service");
const logger_1 = require("../../logger");
const notification_gateway_1 = require("../../realtime/notification-gateway");
const face_verification_monitoring_1 = require("./face-verification-monitoring");
const face_verification_stream_1 = require("./face-verification-stream");
class FaceVerificationController {
    // ── Existing Endpoints (for backward-compatibility with current frontend) ──
    static async register(req, res, next) {
        try {
            const userId = Number(req.body.userId || req.body.user_id);
            if (!userId || !Number.isInteger(userId) || userId <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid or missing user_id'));
            }
            const uploadedFile = req.file ?? getUploadedFileFromFields(req.files);
            if (!uploadedFile) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Image file is required'));
            }
            const data = await face_verification_service_1.FaceVerificationService.registerFace(userId, uploadedFile.buffer, uploadedFile.mimetype, uploadedFile.originalname);
            return res.status(201).json((0, api_response_1.createResponse)(201, 'Face registered successfully', data));
        }
        catch (error) {
            next(error);
        }
    }
    static async verify(req, res, next) {
        try {
            const uploadedFile = req.file ?? getUploadedFileFromFields(req.files);
            if (!uploadedFile) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Image file is required'));
            }
            const threshold = req.body.threshold !== undefined ? Number(req.body.threshold) : undefined;
            if (threshold !== undefined && (isNaN(threshold) || threshold < 0 || threshold > 1)) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Threshold must be a number between 0.0 and 1.0'));
            }
            const data = await face_verification_service_1.FaceVerificationService.verifyFace(uploadedFile.buffer, uploadedFile.mimetype, uploadedFile.originalname, threshold);
            const deviceCode = (typeof req.body?.device_code === 'string' && req.body.device_code.trim()) || 'MAIN_GATE_01';
            const direction = (typeof req.body?.direction === 'string' && req.body.direction.toUpperCase() === 'OUT') ? 'OUT' : 'IN';
            let studentName = data.message || 'ผู้พักอาศัย';
            let roomName = 'หอพัก';
            if (data.matched && data.user_id) {
                try {
                    const user = await db_1.prisma.user.findUnique({
                        where: { id: data.user_id },
                        select: {
                            id: true,
                            username: true,
                            email: true,
                            tenant: { select: { fullName: true, room: { select: { roomNumber: true } } } },
                        },
                    });
                    if (user) {
                        studentName = user.tenant?.fullName || user.username || user.email || `Resident #${user.id}`;
                        roomName = user.tenant?.room?.roomNumber ? `ห้อง ${user.tenant.room.roomNumber}` : 'หอพัก';
                    }
                    const scannedAt = new Date().toISOString();
                    // Save to AccessLog in Database
                    await db_1.prisma.accessLog.create({
                        data: {
                            userId: data.user_id,
                            method: 'FACE_GATE',
                            path: direction,
                            ip: deviceCode,
                            duration: Math.round((data.similarity ?? 1.0) * 100),
                        },
                    });
                    // Broadcast to monitoring bus (SSE)
                    face_verification_monitoring_1.faceVerificationMonitoringBus.recordScan({
                        id: `scan-${data.user_id}-${Date.now()}`,
                        student_code: `user_${data.user_id}`,
                        direction,
                        confidence: data.similarity ?? 1.0,
                        scanned_at: scannedAt,
                        device_code: deviceCode,
                        action: direction === 'IN' ? 'checkin' : 'checkout',
                        student: {
                            code: `user_${data.user_id}`,
                            name: studentName,
                            room: roomName,
                        },
                    });
                }
                catch (busErr) {
                    logger_1.logger.warn({ busErr, userId: data.user_id }, 'Failed to broadcast scan to monitoring bus');
                }
            }
            const responsePayload = {
                ...data,
                student_name: studentName,
                action: direction === 'IN' ? 'checkin' : 'checkout',
                device_code: deviceCode,
            };
            const message = data.matched ? 'Face matched successfully' : (data.message || 'Face did not match registered templates');
            return res.status(200).json((0, api_response_1.createResponse)(200, message, responsePayload));
        }
        catch (error) {
            next(error);
        }
    }
    static async getTemplate(req, res, next) {
        try {
            const templateId = Number(req.params.templateId);
            if (!templateId || !Number.isInteger(templateId) || templateId <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid template ID'));
            }
            const data = await face_verification_service_1.FaceVerificationService.getFaceTemplate(templateId);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Face template retrieved successfully', data));
        }
        catch (error) {
            next(error);
        }
    }
    static async updateTemplate(req, res, next) {
        try {
            const templateId = Number(req.params.templateId);
            if (!templateId || !Number.isInteger(templateId) || templateId <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid template ID'));
            }
            const uploadedFile = req.file ?? getUploadedFileFromFields(req.files);
            if (!uploadedFile) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'New image file is required'));
            }
            const data = await face_verification_service_1.FaceVerificationService.updateFaceTemplate(templateId, uploadedFile.buffer, uploadedFile.mimetype, uploadedFile.originalname);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Face template updated successfully', data));
        }
        catch (error) {
            next(error);
        }
    }
    static async deleteTemplate(req, res, next) {
        try {
            const templateId = Number(req.params.templateId);
            if (!templateId || !Number.isInteger(templateId) || templateId <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid template ID'));
            }
            const data = await face_verification_service_1.FaceVerificationService.deleteFaceTemplate(templateId);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Face template deleted successfully', data));
        }
        catch (error) {
            next(error);
        }
    }
    // ── New FaceGate.Edge Integration Endpoints ──
    static async embeddings(req, res, next) {
        try {
            const since = req.query.since;
            const result = await face_verification_service_1.FaceVerificationService.getEmbeddings(since);
            return res.status(200).json(result);
        }
        catch (error) {
            next(error);
        }
    }
    static async pending(req, res, next) {
        try {
            const result = await face_verification_service_1.FaceVerificationService.getPendingEnrollments();
            return res.status(200).json(result);
        }
        catch (error) {
            next(error);
        }
    }
    static async photo(req, res, next) {
        try {
            const photoId = Number(req.params.id);
            if (isNaN(photoId) || photoId <= 0) {
                return res.status(400).json({ error: 'Invalid photo ID' });
            }
            const filePath = await face_verification_service_1.FaceVerificationService.getEnrollmentPhoto(photoId);
            return res.status(200).sendFile(filePath);
        }
        catch (error) {
            next(error);
        }
    }
    static async storeEmbeddings(req, res, next) {
        try {
            const studentId = Number(req.params.studentId);
            const { model_version, embeddings, quality_scores } = req.body;
            if (isNaN(studentId) || studentId <= 0 || !model_version || !embeddings || !Array.isArray(embeddings)) {
                return res.status(400).json({ status: 'rejected', reason: 'bad_request' });
            }
            const stored = await face_verification_service_1.FaceVerificationService.storeEmbeddings(studentId, model_version, embeddings, quality_scores);
            return res.status(200).json({ status: 'ok', stored });
        }
        catch (error) {
            next(error);
        }
    }
    static async scan(req, res, next) {
        try {
            const { student_code, direction, confidence, scanned_at, device_code, snapshot_base64 } = req.body;
            if (!student_code || !direction || !scanned_at) {
                return res.status(400).json({ status: 'ignored', reason: 'missing_required_fields' });
            }
            if (direction !== 'IN' && direction !== 'OUT') {
                return res.status(400).json({ status: 'ignored', reason: 'invalid_direction' });
            }
            const result = await face_verification_service_1.FaceVerificationService.recordScan(student_code, direction, confidence !== undefined ? Number(confidence) : 1.0, scanned_at, device_code, snapshot_base64);
            face_verification_monitoring_1.faceVerificationMonitoringBus.recordScan({
                id: `${student_code}-${scanned_at}`,
                student_code,
                direction,
                confidence: confidence !== undefined ? Number(confidence) : 1.0,
                scanned_at,
                device_code,
                action: result.action,
                student: result.student,
            });
            return res.status(200).json(result);
        }
        catch (error) {
            next(error);
        }
    }
    static async heartbeat(req, res, next) {
        try {
            const { device_code } = req.body;
            if (!device_code) {
                return res.status(400).json({ status: 'ignored', reason: 'missing_device_code' });
            }
            face_verification_monitoring_1.faceVerificationMonitoringBus.recordHeartbeat(device_code);
            logger_1.logger.info({ deviceCode: device_code }, 'Device heartbeat verified');
            return res.status(200).json({ status: 'ok' });
        }
        catch (error) {
            next(error);
        }
    }
    static async doorCommand(req, res, next) {
        try {
            const { device_code, action, timestamp } = req.body ?? {};
            const normalizedAction = typeof action === 'string' ? action.toLowerCase() : '';
            if (!device_code) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'device_code is required'));
            }
            if (!['lock', 'unlock'].includes(normalizedAction)) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'action must be either lock or unlock'));
            }
            const payload = {
                device_code,
                action: normalizedAction,
                timestamp: timestamp || new Date().toISOString(),
                status: normalizedAction === 'unlock' ? 'opened' : 'locked',
            };
            logger_1.logger.info({ ...payload }, 'Door command processed');
            (0, notification_gateway_1.publishAdminAlert)(0, 'DOOR_COMMAND', normalizedAction === 'unlock' ? `เปิดประตู ${device_code}` : `ปิดประตู ${device_code}`, payload.status.toUpperCase());
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Door command processed successfully', payload));
        }
        catch (error) {
            next(error);
        }
    }
    static async liveFrame(req, res, next) {
        try {
            const { device_code, frame_base64 } = req.body;
            if (!device_code || !frame_base64) {
                return res.status(400).json({ status: 'ignored', reason: 'missing_required_fields' });
            }
            const binary = Buffer.from(frame_base64, 'base64');
            const publicDir = path_1.default.join(process.cwd(), 'public', 'live');
            await promises_1.default.mkdir(publicDir, { recursive: true });
            await promises_1.default.writeFile(path_1.default.join(publicDir, 'feed.jpg'), binary);
            face_verification_stream_1.faceVerificationStream.publish(binary);
            face_verification_monitoring_1.faceVerificationMonitoringBus.recordLiveFrame(device_code);
            return res.status(200).json({ status: 'ok' });
        }
        catch (error) {
            next(error);
        }
    }
    static async liveStream(_req, res) {
        res.status(200);
        face_verification_stream_1.faceVerificationStream.subscribe(res);
    }
    // Accept generic detection payloads from external detectors and broadcast as 'scan' events
    static async detections(req, res, next) {
        try {
            const payload = req.body || {};
            const { id, confidence, scanned_at, device_code, direction } = payload;
            if (!id || !scanned_at) {
                return res.status(400).json({ status: 'ignored', reason: 'missing_required_fields' });
            }
            const scan = {
                id: String(id),
                student_code: payload.student_code || '',
                direction: direction === 'OUT' ? 'OUT' : 'IN',
                confidence: confidence !== undefined ? Number(confidence) : 0,
                scanned_at,
                device_code,
                action: payload.action,
                student: payload.student,
            };
            // Record to monitoring bus (will broadcast SSE 'scan')
            face_verification_monitoring_1.faceVerificationMonitoringBus.recordScan(scan);
            return res.status(200).json({ status: 'ok' });
        }
        catch (error) {
            next(error);
        }
    }
    static async scanHistory(_req, res, next) {
        try {
            const liveItems = face_verification_monitoring_1.faceVerificationMonitoringBus.getScanHistory();
            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            const dbLogs = await db_1.prisma.accessLog.findMany({
                where: {
                    method: { in: ['FACE_GATE', 'FACE_VERIFY'] },
                    createdAt: { gte: startOfToday },
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true,
                            tenant: { select: { fullName: true, room: { select: { roomNumber: true } } } },
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
                take: 30,
            });
            const mergedMap = new Map();
            liveItems.forEach((item) => mergedMap.set(item.id, item));
            for (const log of dbLogs) {
                const id = `db-${log.id}`;
                if (!mergedMap.has(id)) {
                    const isOut = log.path === 'OUT' || log.path === 'CHECKOUT';
                    const direction = isOut ? 'OUT' : 'IN';
                    const studentName = log.user?.tenant?.fullName || log.user?.username || log.user?.email || (log.userId ? `Resident #${log.userId}` : 'ผู้พักอาศัย');
                    const room = log.user?.tenant?.room?.roomNumber ? `ห้อง ${log.user.tenant.room.roomNumber}` : 'หอพัก';
                    mergedMap.set(id, {
                        id,
                        student_code: log.userId ? `user_${log.userId}` : 'unknown',
                        direction,
                        confidence: log.duration ? Math.min(1, log.duration / 100) : 0.95,
                        scanned_at: log.createdAt.toISOString(),
                        device_code: log.ip || 'MAIN_GATE_01',
                        action: direction === 'IN' ? 'checkin' : 'checkout',
                        student: {
                            code: log.userId ? `user_${log.userId}` : 'unknown',
                            name: studentName,
                            room,
                        },
                    });
                }
            }
            const items = Array.from(mergedMap.values()).slice(0, 30);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Scan history retrieved successfully', {
                scans: items,
                items,
            }));
        }
        catch (error) {
            next(error);
        }
    }
    static async devices(_req, res, next) {
        try {
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Camera device status retrieved successfully', {
                items: face_verification_monitoring_1.faceVerificationMonitoringBus.getDevices(),
            }));
        }
        catch (error) {
            next(error);
        }
    }
    static async events(req, res) {
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
        face_verification_monitoring_1.faceVerificationMonitoringBus.subscribe(res);
        const keepAlive = setInterval(() => {
            res.write(`event: ping\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
        }, 15000);
        req.on('close', () => {
            clearInterval(keepAlive);
            res.end();
        });
    }
}
exports.FaceVerificationController = FaceVerificationController;
const getUploadedFileFromFields = (files) => {
    if (!files || Array.isArray(files)) {
        return undefined;
    }
    return files.file?.[0] ?? files.image?.[0] ?? files.idCard?.[0] ?? files.document?.[0];
};
