import { Request, Response, NextFunction } from 'express';
import { createResponse } from '../../shared/api-response';
import { FaceVerificationService } from './face-verification.service';

export class FaceVerificationController {
  static async register(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = Number(req.body.userId || req.body.user_id);
      if (!userId || !Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid or missing user_id'));
      }

      const uploadedFile = req.file ?? getUploadedFileFromFields(req.files);
      if (!uploadedFile) {
        return res.status(400).json(createResponse(400, 'Image file is required'));
      }

      const data = await FaceVerificationService.registerFace(
        userId,
        uploadedFile.buffer,
        uploadedFile.mimetype,
        uploadedFile.originalname
      );

      return res.status(201).json(createResponse(201, 'Face registered successfully', data));
    } catch (error) {
      next(error);
    }
  }

  static async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const uploadedFile = req.file ?? getUploadedFileFromFields(req.files);
      if (!uploadedFile) {
        return res.status(400).json(createResponse(400, 'Image file is required'));
      }

      const threshold = req.body.threshold !== undefined ? Number(req.body.threshold) : undefined;
      if (threshold !== undefined && (isNaN(threshold) || threshold < 0 || threshold > 1)) {
        return res.status(400).json(createResponse(400, 'Threshold must be a number between 0.0 and 1.0'));
      }

      const data = await FaceVerificationService.verifyFace(
        uploadedFile.buffer,
        uploadedFile.mimetype,
        uploadedFile.originalname,
        threshold
      );

      const message = data.matched ? 'Face matched successfully' : (data.message || 'Face did not match registered templates');
      return res.status(200).json(createResponse(200, message, data));
    } catch (error) {
      next(error);
    }
  }

  static async getTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const templateId = Number(req.params.templateId);
      if (!templateId || !Number.isInteger(templateId) || templateId <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid template ID'));
      }

      const data = await FaceVerificationService.getFaceTemplate(templateId);
      return res.status(200).json(createResponse(200, 'Face template retrieved successfully', data));
    } catch (error) {
      next(error);
    }
  }

  static async updateTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const templateId = Number(req.params.templateId);
      if (!templateId || !Number.isInteger(templateId) || templateId <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid template ID'));
      }

      const uploadedFile = req.file ?? getUploadedFileFromFields(req.files);
      if (!uploadedFile) {
        return res.status(400).json(createResponse(400, 'New image file is required'));
      }

      const data = await FaceVerificationService.updateFaceTemplate(
        templateId,
        uploadedFile.buffer,
        uploadedFile.mimetype,
        uploadedFile.originalname
      );

      return res.status(200).json(createResponse(200, 'Face template updated successfully', data));
    } catch (error) {
      next(error);
    }
  }

  static async deleteTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const templateId = Number(req.params.templateId);
      if (!templateId || !Number.isInteger(templateId) || templateId <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid template ID'));
      }

      const data = await FaceVerificationService.deleteFaceTemplate(templateId);
      return res.status(200).json(createResponse(200, 'Face template deleted successfully', data));
    } catch (error) {
      next(error);
    }
  }
}

const getUploadedFileFromFields = (files: Request['files']): Express.Multer.File | undefined => {
  if (!files || Array.isArray(files)) {
    return undefined;
  }

  return files.file?.[0] ?? files.image?.[0] ?? files.idCard?.[0] ?? files.document?.[0];
};
