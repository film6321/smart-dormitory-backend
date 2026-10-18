import { requestBody, text, optionalText } from '../../shared/input';
import { NextFunction, Request, Response } from 'express';
import { createResponse } from '../../shared/api-response';
import { AppError } from '../../middlewares/error-handler';
import { canTransitionVisitorStatus } from '../../shared/state-transitions';
import { VisitorService } from './visitor.service';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { VisitorAccessDto } from './visitor.dto';
import { AuthenticatedRequest } from '../../middlewares/auth-jwt';

const getUploadedFileFromFields = (files: Request['files']): Express.Multer.File | undefined => {
  if (!files || Array.isArray(files)) {
    return undefined;
  }

  return files.file?.[0] ?? files.image?.[0] ?? files.idCard?.[0] ?? files.document?.[0];
};

export class VisitorController {
  static async recordVisitAccess(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw new AppError('รหัสผู้มาติดต่อไม่ถูกต้อง', 400);
      if (!requestBody(req.body) || typeof requestBody(req.body) !== 'object' || Array.isArray(requestBody(req.body))) throw new AppError('ข้อมูลไม่ถูกต้อง', 400);
      const input = plainToInstance(VisitorAccessDto, requestBody(req.body));
      const errors = validateSync(input, { whitelist: true, forbidNonWhitelisted: true });
      if (errors.length) throw new AppError('กรุณายืนยันข้อมูลผู้มาติดต่อและการดำเนินการ', 400, errors);
      const data = await VisitorService.recordVisitAccess(id, input.action, (req as AuthenticatedRequest).user!.id);
      return res.status(200).json(createResponse(200, 'บันทึกการเข้าพบสำเร็จ', data));
    } catch (error) { next(error); }
  }
  static async scanVisitorIdCard(req: Request, res: Response, next: NextFunction) {
    try {
      const { imageBase64 } = requestBody(req.body) || {};
      const uploadedFile = req.file ?? getUploadedFileFromFields(req.files);
      const inputImageBase64 = uploadedFile
        ? `data:${uploadedFile.mimetype};base64,${uploadedFile.buffer.toString('base64')}`
        : imageBase64;

      if (!inputImageBase64 || typeof inputImageBase64 !== 'string') {
        return res.status(400).json(createResponse(400, 'กรุณาแนบรูปภาพบัตรประชาชน (imageBase64 หรือ อัปโหลดไฟล์)'));
      }

      const parsedData = await VisitorService.scanVisitorIdCard(inputImageBase64);
      return res.status(200).json(createResponse(200, 'อ่านข้อมูลบัตรประชาชนสำเร็จ', parsedData));
    } catch (error) {
      next(error);
    }
  }

  static async registerVisitor(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        guestName,
        phone,
        citizenId,
        relationship,
        age,
        birthDate,
        address,
        idCardImagePath,
        purpose,
        roomId,
        roomNumber,
        requestedTenantName,
        idCardVerificationId,
        expectedEntryTime,
        pdpaConsent,
      } = requestBody(req.body) || {};

      const idempotencyKey = req.header('Idempotency-Key')?.trim();
      if (!idempotencyKey) return res.status(400).json(createResponse(400, 'Idempotency-Key header is required'));
      const visitor = await VisitorService.registerVisitor({
        guestName: text(guestName),
        phone: optionalText(phone),
        citizenId: optionalText(citizenId),
        relationship: optionalText(relationship),
        age: age !== undefined && age !== null ? Number(age) : undefined,
        birthDate: optionalText(birthDate),
        address: optionalText(address),
        idCardImagePath: optionalText(idCardImagePath),
        purpose: optionalText(purpose),
        roomId: roomId ? Number(roomId) : undefined,
        roomNumber: typeof roomNumber === 'string' ? roomNumber : (typeof roomId === 'string' && isNaN(Number(roomId)) ? roomId : undefined),
        requestedTenantName: typeof requestedTenantName === 'string' ? requestedTenantName : '',
        idCardVerificationId: Number(idCardVerificationId),
        expectedEntryTime: expectedEntryTime ? new Date(text(expectedEntryTime)) : undefined,
        pdpaConsent: Boolean(pdpaConsent),
      }, idempotencyKey);

      return res.status(201).json(createResponse(201, 'ส่งคำขอผู้มาติดต่อสำเร็จ', {
        id: visitor.id,
        guestName: visitor.guestName,
        roomNumber: visitor.room?.roomNumber,
        requestedTenantName: visitor.requestedTenantName,
        status: visitor.status,
        expiresAt: visitor.expiresAt,
        createdAt: visitor.createdAt,
        expectedEntryTime: visitor.expectedEntryTime,
        purpose: visitor.purpose,
      }));
    } catch (error) {
      next(error);
    }
  }

  static async getVisitorPass(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'รหัสผู้มาติดต่อไม่ถูกต้อง'));
      }

      const pass = await VisitorService.getVisitorPass(id);
      return res.status(200).json(createResponse(200, 'ดึงข้อมูลบัตรผู้มาติดต่อสำเร็จ', pass));
    } catch (error) {
      next(error);
    }
  }

  static async cancelVisitor(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'รหัสผู้มาติดต่อไม่ถูกต้อง'));
      }

      const { reason } = requestBody(req.body);
      const cancelled = await VisitorService.cancelVisitor(id, optionalText(reason));
      return res.status(200).json(createResponse(200, 'ยกเลิกการลงทะเบียนผู้มาติดต่อสำเร็จ', cancelled));
    } catch (error) {
      next(error);
    }
  }

  static async listVisitors(req: Request, res: Response, next: NextFunction) {
    try {
      const visitors = await VisitorService.listVisitors();
      return res.status(200).json(createResponse(200, 'Visitors fetched', visitors));
    } catch (error) {
      next(error);
    }
  }

  static async updateVisitorStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const { status } = requestBody(req.body);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid visitor id'));
      }

      const existingVisitor = await VisitorService.getVisitorById(id);
      if (!existingVisitor) {
        return res.status(404).json(createResponse(404, 'Visitor not found'));
      }

      if (!canTransitionVisitorStatus(existingVisitor.status, text(status))) {
        return next(new AppError('Invalid visitor state transition', 409));
      }

      const updated = await VisitorService.updateVisitorStatus(id, text(status));
      return res.status(200).json(createResponse(200, 'Visitor status updated', updated));
    } catch (error) {
      next(error);
    }
  }
}

