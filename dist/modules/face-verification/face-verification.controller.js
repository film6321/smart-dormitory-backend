"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FaceVerificationController = void 0;
const api_response_1 = require("../../shared/api-response");
const face_verification_service_1 = require("./face-verification.service");
class FaceVerificationController {
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
}
exports.FaceVerificationController = FaceVerificationController;
const getUploadedFileFromFields = (files) => {
    if (!files || Array.isArray(files)) {
        return undefined;
    }
    return files.file?.[0] ?? files.image?.[0] ?? files.idCard?.[0] ?? files.document?.[0];
};
