import { AppError } from '../../middlewares/error-handler';
import { logger } from '../../logger';
import {
  FaceRegisterResponse,
  FaceVerifyResponse,
  FaceTemplateResponse,
  FaceDeleteResponse,
} from './face-verification.types';

const normalizeBaseUrl = (url: string) => url.replace(/\/+$/, '');

const getFaceConfig = () => {
  const baseUrl = process.env.FACE_API_URL || process.env.FACE_API_BASE_URL;
  const apiKey = process.env.FACE_API_KEY;

  if (!baseUrl) {
    throw new AppError('FACE_API_URL is not configured', 500);
  }

  if (!apiKey) {
    throw new AppError('FACE_API_KEY is not configured', 500);
  }

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    apiKey,
  };
};

export class FaceVerificationService {
  static async registerFace(
    userId: number,
    fileBuffer: Buffer,
    mimeType: string,
    fileName: string
  ): Promise<FaceRegisterResponse['data']> {
    const { baseUrl, apiKey } = getFaceConfig();
    const url = `${baseUrl}/api/v1/faces/register`;

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
    formData.append('file', blob, fileName);
    formData.append('user_id', String(userId));

    logger.info({ userId, fileName }, 'Sending face registration request to external service');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
        },
        body: formData,
      });

      const body = await response.json().catch(() => null) as FaceRegisterResponse | null;

      if (!response.ok) {
        const errorDetail = (body as any)?.detail || (body as any)?.message || response.statusText;
        logger.warn({ statusCode: response.status, errorDetail }, 'External face API registration failed');
        throw new AppError(errorDetail || 'Face registration failed', response.status === 422 ? 400 : response.status);
      }

      if (!body || !body.success) {
        throw new AppError(body?.message || 'Face registration failed', 400);
      }

      return body.data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error }, 'Error calling external face registration API');
      throw new AppError('Face verification service is currently unavailable', 503);
    }
  }

  static async verifyFace(
    fileBuffer: Buffer,
    mimeType: string,
    fileName: string,
    threshold?: number
  ): Promise<FaceVerifyResponse> {
    const { baseUrl, apiKey } = getFaceConfig();
    const url = `${baseUrl}/api/v1/faces/verify`;

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
    formData.append('file', blob, fileName);
    if (threshold !== undefined) {
      formData.append('threshold', String(threshold));
    }

    logger.info({ fileName, threshold }, 'Sending face verification request to external service');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
        },
        body: formData,
      });

      const body = await response.json().catch(() => null) as FaceVerifyResponse | null;

      if (!response.ok) {
        const errorDetail = (body as any)?.detail || (body as any)?.message || response.statusText;
        logger.warn({ statusCode: response.status, errorDetail }, 'External face API verification failed');
        throw new AppError(errorDetail || 'Face verification failed', response.status === 422 ? 400 : response.status);
      }

      if (!body) {
        throw new AppError('Invalid response from face verification service', 502);
      }

      return body;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error }, 'Error calling external face verification API');
      throw new AppError('Face verification service is currently unavailable', 503);
    }
  }

  static async getFaceTemplate(templateId: number): Promise<FaceTemplateResponse> {
    const { baseUrl, apiKey } = getFaceConfig();
    const url = `${baseUrl}/api/v1/faces/${templateId}`;

    logger.info({ templateId }, 'Retrieving face template from external service');

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': apiKey,
        },
      });

      const body = await response.json().catch(() => null) as FaceTemplateResponse | null;

      if (!response.ok) {
        const errorDetail = (body as any)?.detail || (body as any)?.message || response.statusText;
        logger.warn({ statusCode: response.status, templateId, errorDetail }, 'Failed to retrieve face template');
        throw new AppError(errorDetail || 'Template not found', response.status);
      }

      if (!body) {
        throw new AppError('Invalid response from template endpoint', 502);
      }

      return body;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, templateId }, 'Error calling external face templates API');
      throw new AppError('Face verification service is currently unavailable', 503);
    }
  }

  static async updateFaceTemplate(
    templateId: number,
    fileBuffer: Buffer,
    mimeType: string,
    fileName: string
  ): Promise<FaceRegisterResponse['data']> {
    const { baseUrl, apiKey } = getFaceConfig();
    const url = `${baseUrl}/api/v1/faces/${templateId}`;

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
    formData.append('file', blob, fileName);

    logger.info({ templateId, fileName }, 'Updating face template on external service');

    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'X-API-Key': apiKey,
        },
        body: formData,
      });

      const body = await response.json().catch(() => null) as FaceRegisterResponse | null;

      if (!response.ok) {
        const errorDetail = (body as any)?.detail || (body as any)?.message || response.statusText;
        logger.warn({ statusCode: response.status, templateId, errorDetail }, 'Failed to update face template');
        throw new AppError(errorDetail || 'Template update failed', response.status === 422 ? 400 : response.status);
      }

      if (!body || !body.success) {
        throw new AppError(body?.message || 'Face template update failed', 400);
      }

      return body.data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, templateId }, 'Error updating face template');
      throw new AppError('Face verification service is currently unavailable', 503);
    }
  }

  static async deleteFaceTemplate(templateId: number): Promise<FaceDeleteResponse> {
    const { baseUrl, apiKey } = getFaceConfig();
    const url = `${baseUrl}/api/v1/faces/${templateId}`;

    logger.info({ templateId }, 'Deleting face template from external service');

    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'X-API-Key': apiKey,
        },
      });

      const body = await response.json().catch(() => null) as FaceDeleteResponse | null;

      if (!response.ok) {
        const errorDetail = (body as any)?.detail || (body as any)?.message || response.statusText;
        logger.warn({ statusCode: response.status, templateId, errorDetail }, 'Failed to delete face template');
        throw new AppError(errorDetail || 'Failed to delete template', response.status);
      }

      if (!body || !body.success) {
        throw new AppError(body?.message || 'Face template deletion failed', 400);
      }

      return body;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, templateId }, 'Error deleting face template');
      throw new AppError('Face verification service is currently unavailable', 503);
    }
  }
}
