"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FaceVerificationService = void 0;
const error_handler_1 = require("../../middlewares/error-handler");
const logger_1 = require("../../logger");
const normalizeBaseUrl = (url) => url.replace(/\/+$/, '');
const getFaceConfig = () => {
    const baseUrl = process.env.FACE_API_URL || process.env.FACE_API_BASE_URL;
    const apiKey = process.env.FACE_API_KEY;
    if (!baseUrl) {
        throw new error_handler_1.AppError('FACE_API_URL is not configured', 500);
    }
    if (!apiKey) {
        throw new error_handler_1.AppError('FACE_API_KEY is not configured', 500);
    }
    return {
        baseUrl: normalizeBaseUrl(baseUrl),
        apiKey,
    };
};
class FaceVerificationService {
    static async registerFace(userId, fileBuffer, mimeType, fileName) {
        const { baseUrl, apiKey } = getFaceConfig();
        const url = `${baseUrl}/api/v1/faces/register`;
        const formData = new FormData();
        const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
        formData.append('file', blob, fileName);
        formData.append('user_id', String(userId));
        logger_1.logger.info({ userId, fileName }, 'Sending face registration request to external service');
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'X-API-Key': apiKey,
                },
                body: formData,
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) {
                const errorDetail = body?.detail || body?.message || response.statusText;
                logger_1.logger.warn({ statusCode: response.status, errorDetail }, 'External face API registration failed');
                throw new error_handler_1.AppError(errorDetail || 'Face registration failed', response.status === 422 ? 400 : response.status);
            }
            if (!body || !body.success) {
                throw new error_handler_1.AppError(body?.message || 'Face registration failed', 400);
            }
            return body.data;
        }
        catch (error) {
            if (error instanceof error_handler_1.AppError)
                throw error;
            logger_1.logger.error({ error }, 'Error calling external face registration API');
            throw new error_handler_1.AppError('Face verification service is currently unavailable', 503);
        }
    }
    static async verifyFace(fileBuffer, mimeType, fileName, threshold) {
        const { baseUrl, apiKey } = getFaceConfig();
        const url = `${baseUrl}/api/v1/faces/verify`;
        const formData = new FormData();
        const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
        formData.append('file', blob, fileName);
        if (threshold !== undefined) {
            formData.append('threshold', String(threshold));
        }
        logger_1.logger.info({ fileName, threshold }, 'Sending face verification request to external service');
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'X-API-Key': apiKey,
                },
                body: formData,
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) {
                const errorDetail = body?.detail || body?.message || response.statusText;
                logger_1.logger.warn({ statusCode: response.status, errorDetail }, 'External face API verification failed');
                throw new error_handler_1.AppError(errorDetail || 'Face verification failed', response.status === 422 ? 400 : response.status);
            }
            if (!body) {
                throw new error_handler_1.AppError('Invalid response from face verification service', 502);
            }
            return body;
        }
        catch (error) {
            if (error instanceof error_handler_1.AppError)
                throw error;
            logger_1.logger.error({ error }, 'Error calling external face verification API');
            throw new error_handler_1.AppError('Face verification service is currently unavailable', 503);
        }
    }
    static async getFaceTemplate(templateId) {
        const { baseUrl, apiKey } = getFaceConfig();
        const url = `${baseUrl}/api/v1/faces/${templateId}`;
        logger_1.logger.info({ templateId }, 'Retrieving face template from external service');
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'X-API-Key': apiKey,
                },
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) {
                const errorDetail = body?.detail || body?.message || response.statusText;
                logger_1.logger.warn({ statusCode: response.status, templateId, errorDetail }, 'Failed to retrieve face template');
                throw new error_handler_1.AppError(errorDetail || 'Template not found', response.status);
            }
            if (!body) {
                throw new error_handler_1.AppError('Invalid response from template endpoint', 502);
            }
            return body;
        }
        catch (error) {
            if (error instanceof error_handler_1.AppError)
                throw error;
            logger_1.logger.error({ error, templateId }, 'Error calling external face templates API');
            throw new error_handler_1.AppError('Face verification service is currently unavailable', 503);
        }
    }
    static async updateFaceTemplate(templateId, fileBuffer, mimeType, fileName) {
        const { baseUrl, apiKey } = getFaceConfig();
        const url = `${baseUrl}/api/v1/faces/${templateId}`;
        const formData = new FormData();
        const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
        formData.append('file', blob, fileName);
        logger_1.logger.info({ templateId, fileName }, 'Updating face template on external service');
        try {
            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'X-API-Key': apiKey,
                },
                body: formData,
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) {
                const errorDetail = body?.detail || body?.message || response.statusText;
                logger_1.logger.warn({ statusCode: response.status, templateId, errorDetail }, 'Failed to update face template');
                throw new error_handler_1.AppError(errorDetail || 'Template update failed', response.status === 422 ? 400 : response.status);
            }
            if (!body || !body.success) {
                throw new error_handler_1.AppError(body?.message || 'Face template update failed', 400);
            }
            return body.data;
        }
        catch (error) {
            if (error instanceof error_handler_1.AppError)
                throw error;
            logger_1.logger.error({ error, templateId }, 'Error updating face template');
            throw new error_handler_1.AppError('Face verification service is currently unavailable', 503);
        }
    }
    static async deleteFaceTemplate(templateId) {
        const { baseUrl, apiKey } = getFaceConfig();
        const url = `${baseUrl}/api/v1/faces/${templateId}`;
        logger_1.logger.info({ templateId }, 'Deleting face template from external service');
        try {
            const response = await fetch(url, {
                method: 'DELETE',
                headers: {
                    'X-API-Key': apiKey,
                },
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) {
                const errorDetail = body?.detail || body?.message || response.statusText;
                logger_1.logger.warn({ statusCode: response.status, templateId, errorDetail }, 'Failed to delete face template');
                throw new error_handler_1.AppError(errorDetail || 'Failed to delete template', response.status);
            }
            if (!body || !body.success) {
                throw new error_handler_1.AppError(body?.message || 'Face template deletion failed', 400);
            }
            return body;
        }
        catch (error) {
            if (error instanceof error_handler_1.AppError)
                throw error;
            logger_1.logger.error({ error, templateId }, 'Error deleting face template');
            throw new error_handler_1.AppError('Face verification service is currently unavailable', 503);
        }
    }
}
exports.FaceVerificationService = FaceVerificationService;
