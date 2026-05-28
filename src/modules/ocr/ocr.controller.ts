import { Request, Response, NextFunction } from 'express';
import { createResponse } from '../../shared/api-response';
import { AuthenticatedRequest } from '../../middlewares/auth-jwt';
import { OcrService } from './ocr.service';
import { VerifyIdCardRequest } from './ocr.types';

export class OcrController {
  static async verifyIdCard(req: Request, res: Response, next: NextFunction) {
    try {
      const { imageBase64 } = req.body as Partial<VerifyIdCardRequest>;
      const uploadedFile = req.file ?? getUploadedFileFromFields(req.files);
      const inputImageBase64 = uploadedFile
        ? `data:${uploadedFile.mimetype};base64,${uploadedFile.buffer.toString('base64')}`
        : imageBase64;

      if (!inputImageBase64 || typeof inputImageBase64 !== 'string') {
        return res.status(400).json(createResponse(400, 'imageBase64 or file is required'));
      }

      const data = await OcrService.verifyIdCard(inputImageBase64, {
        userId: (req as AuthenticatedRequest).user?.id,
      });
      const message = data.isThaiIdCard ? 'Thai ID card verified' : 'Image is not a valid Thai ID card';

      return res.status(200).json(createResponse(200, message, data));
    } catch (error) {
      return next(error);
    }
  }

  static async deleteIdCardVerification(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid verification id'));
      }

      const data = await OcrService.deleteIdCardVerification(id);

      return res.status(200).json(createResponse(200, 'Id card verification deleted', data));
    } catch (error) {
      return next(error);
    }
  }

  static async listIdCardVerifications(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Number(req.query.page ?? 1);
      const limit = Number(req.query.limit ?? 20);
      const data = await OcrService.listIdCardVerifications(
        Number.isFinite(page) ? page : 1,
        Number.isFinite(limit) ? limit : 20,
      );

      return res.status(200).json(createResponse(200, 'Id card verifications retrieved', data));
    } catch (error) {
      return next(error);
    }
  }

  static async getIdCardVerification(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid verification id'));
      }

      const data = await OcrService.getIdCardVerification(id);

      return res.status(200).json(createResponse(200, 'Id card verification retrieved', data));
    } catch (error) {
      return next(error);
    }
  }

  static async getIdCardVerificationImage(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid verification id'));
      }

      const image = await OcrService.getIdCardVerificationImage(id);

      res.setHeader('Content-Type', image.contentType);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.sendFile(image.absolutePath);
    } catch (error) {
      return next(error);
    }
  }
}

const getUploadedFileFromFields = (files: Request['files']): Express.Multer.File | undefined => {
  if (!files || Array.isArray(files)) {
    return undefined;
  }

  return files.file?.[0] ?? files.image?.[0] ?? files.idCard?.[0] ?? files.document?.[0];
};
