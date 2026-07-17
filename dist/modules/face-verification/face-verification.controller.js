"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FaceVerificationController = void 0;
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const api_response_1 = require("../../shared/api-response");
const face_verification_service_1 = require("./face-verification.service");
const logger_1 = require("../../logger");
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
            const message = data.matched ? 'Face matched successfully' : (data.message || 'Face did not match registered templates');
            return res.status(200).json((0, api_response_1.createResponse)(200, message, data));
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
            logger_1.logger.info({ deviceCode: device_code }, 'Device heartbeat verified');
            return res.status(200).json({ status: 'ok' });
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
            return res.status(200).json({ status: 'ok' });
        }
        catch (error) {
            next(error);
        }
    }
}
exports.FaceVerificationController = FaceVerificationController;
const getUploadedFileFromFields = (files) => {
    if (!files || Array.isArray(files)) {
        return undefined;
    }
    return files.file?.[0] ?? files.image?.[0] ?? files.idCard?.[0] ?? files.document?.[0];
};
