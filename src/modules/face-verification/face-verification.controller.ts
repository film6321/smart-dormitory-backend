import { requestBody, text, optionalText, isNumberMatrix, isNumberArray } from '../../shared/input';
import { FaceCleanupService } from './face-cleanup.service';
import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { prisma } from '../../database/db';
import { createResponse } from '../../shared/api-response';
import { FaceVerificationService } from './face-verification.service';
import { logger } from '../../logger';
import { faceVerificationMonitoringBus, type CameraScanSnapshot } from './face-verification-monitoring';
import { faceVerificationStream } from './face-verification-stream';
import { recordFaceVerificationAttempt } from '../../setup/observability-metrics';
import type { AuthenticatedRequest } from '../../middlewares/auth-jwt';

export class FaceVerificationController {
  // ── Existing Endpoints (for backward-compatibility with current frontend) ──

  static async register(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = Number(requestBody(req.body).userId || requestBody(req.body).user_id);
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

      const threshold = requestBody(req.body).threshold !== undefined ? Number(requestBody(req.body).threshold) : undefined;
      if (threshold !== undefined && (isNaN(threshold) || threshold < 0 || threshold > 1)) {
        return res.status(400).json(createResponse(400, 'Threshold must be a number between 0.0 and 1.0'));
      }

      const effectiveThreshold = threshold !== undefined ? threshold : FaceVerificationService.DEFAULT_SIMILARITY_THRESHOLD;

      const data = await FaceVerificationService.verifyFace(
        uploadedFile.buffer,
        uploadedFile.mimetype,
        uploadedFile.originalname,
        effectiveThreshold
      );
      recordFaceVerificationAttempt(data.matched ? 'matched' : 'not_matched');

      const deviceCode = optionalText(requestBody(req.body).device_code)?.trim() || 'MAIN_GATE_01';
      const direction = optionalText(requestBody(req.body).direction)?.toUpperCase() === 'OUT' ? 'OUT' : 'IN';
      let studentName = data.message || 'ผู้พักอาศัย';
      let cooldownActive = false;

      if (data.matched && data.user_id) {
        const studentCode = data.user_id > 1000000 ? `visitor_${data.user_id - 1000000}` : `user_${data.user_id}`;
        const scan = await FaceVerificationService.recordScan(studentCode, direction, data.similarity,
          new Date().toISOString(), deviceCode);
        studentName = scan.student.name;
        cooldownActive = scan.cooldown_active;
        if (!cooldownActive && scan.id && scan.scanned_at) faceVerificationMonitoringBus.recordScan({
          id: scan.id, student_code: studentCode, direction,
          confidence: data.similarity, scanned_at: scan.scanned_at, device_code: deviceCode,
          action: scan.action, activity_type: 'FACE_SCAN', student: scan.student,
        });
      }

      const responsePayload = {
        ...data,
        student_name: studentName,
        action: data.matched ? (direction === 'IN' ? 'checkin' : 'checkout') : 'denied',
        device_code: deviceCode,
        cooldown_active: cooldownActive,
        door_status: FaceVerificationService.getSimulatedDoorStatus(deviceCode),
        door_auto_close_at: FaceVerificationService.getSimulatedDoorAutoCloseAt(deviceCode),
        similarity_threshold: effectiveThreshold,
      };

      const message = data.matched ? 'Face matched successfully' : (data.message || 'Face did not match registered templates');
      return res.status(200).json(createResponse(200, message, responsePayload));
    } catch (error) {
      recordFaceVerificationAttempt('error');
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

  static async pendingCleanup(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await FaceCleanupService.pending();
      return res.status(200).json(createResponse(200, 'Pending cleanup retrieved', data));
    } catch (error) { next(error); }
  }

  static async cleanupStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await FaceCleanupService.status(String(req.params.taskKey));
      return res.status(200).json(createResponse(200, 'Cleanup status retrieved', data));
    } catch (error) { next(error); }
  }

  static async deleteTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const templateId = Number(req.params.templateId);
      if (!templateId || !Number.isInteger(templateId) || templateId <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid template ID'));
      }

      const data = await FaceVerificationService.deleteFaceTemplate(templateId);
      const status = data.cleanup?.status === 'PENDING' ? 202 : 200;
      return res.status(status).json(createResponse(status, data.message, data));
    } catch (error) {
      next(error);
    }
  }

  static async requestUserReEnrollment(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = Number(req.params.userId);
      if (!Number.isSafeInteger(userId) || userId <= 0 || userId >= 1000000) {
        return res.status(400).json(createResponse(400, 'Invalid user ID'));
      }
      const data = await FaceVerificationService.requestUserReEnrollment(userId);
      const status = data.reEnrollmentReady ? 200 : 202;
      return res.status(status).json(createResponse(status, data.message, data));
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
      const { model_version, embeddings, quality_scores } = requestBody(req.body);

      if (isNaN(studentId) || studentId <= 0 || typeof model_version !== 'string' || !isNumberMatrix(embeddings) || quality_scores !== undefined && !isNumberArray(quality_scores)) {
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
      const { student_code, direction, confidence, scanned_at, device_code, snapshot_base64 } = requestBody(req.body);

      if (typeof student_code !== 'string' || !direction || typeof scanned_at !== 'string') {
        return res.status(400).json({ status: 'ignored', reason: 'missing_required_fields' });
      }

      if (direction !== 'IN' && direction !== 'OUT') {
        return res.status(400).json({ status: 'ignored', reason: 'invalid_direction' });
      }

      const result = await FaceVerificationService.recordScan(
        student_code,
        direction,
        confidence !== undefined ? Number(confidence) : 1.0,
        text(scanned_at),
        optionalText(device_code),
        optionalText(snapshot_base64)
      );

      if (!result.cooldown_active && result.id && result.scanned_at) {
        faceVerificationMonitoringBus.recordScan({
          id: result.id,
          student_code,
          direction,
          confidence: confidence !== undefined ? Number(confidence) : 1.0,
          scanned_at: result.scanned_at,
          device_code: optionalText(device_code),
          action: result.action,
          activity_type: 'FACE_SCAN',
          student: result.student,
        });
      }

      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async heartbeat(req: Request, res: Response, next: NextFunction) {
    try {
      const { device_code } = requestBody(req.body);
      if (typeof device_code !== 'string' || !device_code) {
        return res.status(400).json({ status: 'ignored', reason: 'missing_device_code' });
      }

      faceVerificationMonitoringBus.recordHeartbeat(device_code);
      logger.info({ deviceCode: device_code }, 'Device heartbeat verified');
      return res.status(200).json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  }

  static async doorCommand(req: Request, res: Response, next: NextFunction) {
    try {
      const { device_code, action } = requestBody(req.body) ?? {};
      const normalizedAction = typeof action === 'string' ? action.toLowerCase() : '';

      if (!device_code) {
        return res.status(400).json(createResponse(400, 'device_code is required'));
      }

      if (!['lock', 'unlock'].includes(normalizedAction)) {
        return res.status(400).json(createResponse(400, 'action must be either lock or unlock'));
      }

      const userId = (req as AuthenticatedRequest).user?.id;
      if (!userId) return res.status(401).json(createResponse(401, 'Authenticated admin identity is required'));
      const result = await FaceVerificationService.commandSimulatedDoor(userId, String(device_code), normalizedAction as 'unlock' | 'lock');
      return res.status(200).json(createResponse(200, 'Simulated door state updated', result));
    } catch (error) {
      next(error);
    }
  }

  static async liveFrame(req: Request, res: Response, next: NextFunction) {
    try {
      const { device_code, frame_base64 } = requestBody(req.body);
      if (typeof device_code !== 'string' || typeof frame_base64 !== 'string' || !device_code || !frame_base64) {
        return res.status(400).json({ status: 'ignored', reason: 'missing_required_fields' });
      }

      const binary = Buffer.from(frame_base64, 'base64');
      const publicDir = path.join(process.cwd(), 'public', 'live');
      await fs.mkdir(publicDir, { recursive: true });
      await fs.writeFile(path.join(publicDir, 'feed.jpg'), binary);
      faceVerificationStream.publish(binary);
      faceVerificationMonitoringBus.recordLiveFrame(device_code);

      return res.status(200).json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  }

  static async liveStream(_req: Request, res: Response) {
    res.status(200);
    faceVerificationStream.subscribe(res);
  }

  // Accept generic detection payloads from external detectors and broadcast as 'scan' events
  static async detections(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = requestBody(req.body) || {};

      const { id, confidence, scanned_at, device_code, direction } = payload;

      if (!id || !scanned_at) {
        return res.status(400).json({ status: 'ignored', reason: 'missing_required_fields' });
      }

      const scan: CameraScanSnapshot = {
        id: String(id),
        student_code: optionalText(payload.student_code) || '',
        direction: direction === 'OUT' ? 'OUT' : 'IN',
        confidence: confidence !== undefined ? Number(confidence) : 0,
        scanned_at: text(scanned_at),
        device_code: optionalText(device_code),
        action: optionalText(payload.action),
        student: payload.student === undefined ? undefined : (() => { const student = requestBody(payload.student); return {code: text(student.code), name: text(student.name), room: text(student.room)}; })(),
      };

      // Record to monitoring bus (will broadcast SSE 'scan')
      faceVerificationMonitoringBus.recordScan(scan);

      return res.status(200).json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  }

  static async scanHistory(_req: Request, res: Response, next: NextFunction) {
    try {
      const history = await FaceVerificationService.getMonitorHistory();
      return res.status(200).json(createResponse(200, 'Scan history retrieved successfully', history));
    } catch (error) {
      next(error);
    }
  }

  static async clearScanHistory(req: Request, res: Response, next: NextFunction) {
    try {
      // 1. Clear in-memory live stream monitoring history and broadcast snapshot via SSE
      faceVerificationMonitoringBus.clearScanHistory();

      // 2. Clear recent database access logs for face gate if requested
      const clearDb = req.query.clear_db === 'true' || requestBody(req.body)?.clear_db === true || req.query.clear_db === undefined;
      let deletedCount = 0;
      if (clearDb) {
        const deleteResult = await prisma.accessLog.deleteMany({
          where: {
            method: { in: ['FACE_GATE', 'FACE_VERIFY', 'MONITOR_DOOR'] },
          },
        });
        deletedCount = deleteResult.count;
      }

      logger.info({ deletedCount }, 'Face scan history cleared by admin');
      return res.status(200).json(
        createResponse(200, 'Scan history cleared successfully', {
          cleared: true,
          deleted_logs_count: deletedCount,
        }),
      );
    } catch (error) {
      next(error);
    }
  }

  static async devices(_req: Request, res: Response, next: NextFunction) {
    try {
      return res.status(200).json(
        createResponse(200, 'Camera device status retrieved successfully', {
          items: faceVerificationMonitoringBus.getDevices(),
        }),
      );
    } catch (error) {
      next(error);
    }
  }

  static async events(req: Request, res: Response) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    faceVerificationMonitoringBus.subscribe(res);

    const keepAlive = setInterval(() => {
      res.write(`event: ping\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      res.end();
    });
  }
}

const getUploadedFileFromFields = (files: Request['files']): Express.Multer.File | undefined => {
  if (!files || Array.isArray(files)) {
    return undefined;
  }

  return files.file?.[0] ?? files.image?.[0] ?? files.idCard?.[0] ?? files.document?.[0];
};
