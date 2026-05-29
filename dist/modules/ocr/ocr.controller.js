"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OcrController = void 0;
const api_response_1 = require("../../shared/api-response");
const ocr_service_1 = require("./ocr.service");
class OcrController {
    static async verifyIdCard(req, res, next) {
        try {
            const { imageBase64 } = req.body;
            const uploadedFile = req.file ?? getUploadedFileFromFields(req.files);
            const inputImageBase64 = uploadedFile
                ? `data:${uploadedFile.mimetype};base64,${uploadedFile.buffer.toString('base64')}`
                : imageBase64;
            if (!inputImageBase64 || typeof inputImageBase64 !== 'string') {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'imageBase64 or file is required'));
            }
            const data = await ocr_service_1.OcrService.verifyIdCard(inputImageBase64, {
                userId: req.user?.id,
            });
            const message = data.isThaiIdCard ? 'Thai ID card verified' : 'Image is not a valid Thai ID card';
            return res.status(200).json((0, api_response_1.createResponse)(200, message, data));
        }
        catch (error) {
            return next(error);
        }
    }
    static async deleteIdCardVerification(req, res, next) {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid verification id'));
            }
            const data = await ocr_service_1.OcrService.deleteIdCardVerification(id);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Id card verification deleted', data));
        }
        catch (error) {
            return next(error);
        }
    }
    static async listIdCardVerifications(req, res, next) {
        try {
            const page = Number(req.query.page ?? 1);
            const limit = Number(req.query.limit ?? 20);
            const data = await ocr_service_1.OcrService.listIdCardVerifications(Number.isFinite(page) ? page : 1, Number.isFinite(limit) ? limit : 20);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Id card verifications retrieved', data));
        }
        catch (error) {
            return next(error);
        }
    }
    static async getIdCardVerification(req, res, next) {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid verification id'));
            }
            const data = await ocr_service_1.OcrService.getIdCardVerification(id);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Id card verification retrieved', data));
        }
        catch (error) {
            return next(error);
        }
    }
    static async getIdCardVerificationImage(req, res, next) {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid verification id'));
            }
            const image = await ocr_service_1.OcrService.getIdCardVerificationImage(id);
            res.setHeader('Content-Type', image.contentType);
            res.setHeader('Cache-Control', 'private, no-store');
            return res.sendFile(image.absolutePath);
        }
        catch (error) {
            return next(error);
        }
    }
}
exports.OcrController = OcrController;
const getUploadedFileFromFields = (files) => {
    if (!files || Array.isArray(files)) {
        return undefined;
    }
    return files.file?.[0] ?? files.image?.[0] ?? files.idCard?.[0] ?? files.document?.[0];
};
