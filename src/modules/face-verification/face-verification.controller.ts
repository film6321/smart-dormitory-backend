import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { createResponse } from '../../shared/api-response';
import { FaceVerificationService } from './face-verification.service';
import { logger } from '../../logger';

export class FaceVerificationController {
  // ── Existing Endpoints (for backward-compatibility with current frontend) ──

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

  // ── New FaceGate.Edge Integration Endpoints ──

  static async embeddings(req: Request, res: Response, next: NextFunction) {
    try {
      const since = req.query.since as string | undefined;
      const result = await FaceVerificationService.getEmbeddings(since);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async pending(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await FaceVerificationService.getPendingEnrollments();
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async photo(req: Request, res: Response, next: NextFunction) {
    try {
      const photoId = Number(req.params.id);
      if (isNaN(photoId) || photoId <= 0) {
        return res.status(400).json({ error: 'Invalid photo ID' });
      }

      const filePath = await FaceVerificationService.getEnrollmentPhoto(photoId);
      return res.status(200).sendFile(filePath);
    } catch (error) {
      next(error);
    }
  }

  static async storeEmbeddings(req: Request, res: Response, next: NextFunction) {
    try {
      const studentId = Number(req.params.studentId);
      const { model_version, embeddings, quality_scores } = req.body;

      if (isNaN(studentId) || studentId <= 0 || !model_version || !embeddings || !Array.isArray(embeddings)) {
        return res.status(400).json({ status: 'rejected', reason: 'bad_request' });
      }

      const stored = await FaceVerificationService.storeEmbeddings(
        studentId,
        model_version,
        embeddings,
        quality_scores
      );

      return res.status(200).json({ status: 'ok', stored });
    } catch (error) {
      next(error);
    }
  }

  static async scan(req: Request, res: Response, next: NextFunction) {
    try {
      const { student_code, direction, confidence, scanned_at, device_code, snapshot_base64 } = req.body;

      if (!student_code || !direction || !scanned_at) {
        return res.status(400).json({ status: 'ignored', reason: 'missing_required_fields' });
      }

      if (direction !== 'IN' && direction !== 'OUT') {
        return res.status(400).json({ status: 'ignored', reason: 'invalid_direction' });
      }

      const result = await FaceVerificationService.recordScan(
        student_code,
        direction,
        confidence !== undefined ? Number(confidence) : 1.0,
        scanned_at,
        device_code,
        snapshot_base64
      );

      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async heartbeat(req: Request, res: Response, next: NextFunction) {
    try {
      const { device_code } = req.body;
      if (!device_code) {
        return res.status(400).json({ status: 'ignored', reason: 'missing_device_code' });
      }

      logger.info({ deviceCode: device_code }, 'Device heartbeat verified');
      return res.status(200).json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  }

  static async liveFrame(req: Request, res: Response, next: NextFunction) {
    try {
      const { device_code, frame_base64 } = req.body;
      if (!device_code || !frame_base64) {
        return res.status(400).json({ status: 'ignored', reason: 'missing_required_fields' });
      }

      const binary = Buffer.from(frame_base64, 'base64');
      const publicDir = path.join(process.cwd(), 'public', 'live');
      await fs.mkdir(publicDir, { recursive: true });
      await fs.writeFile(path.join(publicDir, 'feed.jpg'), binary);

      return res.status(200).json({ status: 'ok' });
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
