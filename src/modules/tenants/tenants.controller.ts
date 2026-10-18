import { requestBody, text } from '../../shared/input';
import { HousingDraftService } from './housing-draft.service';
import { HousingRefundService } from './housing-refund.service';
import { validateTenantUpdate, parseHousingApplication } from './tenants.dto';
import { NextFunction, Request, Response } from 'express';
import { createResponse } from '../../shared/api-response';
import { HousingPaymentService } from './housing-payment.service';
import { TenantsService } from './tenants.service';
import { AuthenticatedRequest } from '../../middlewares/auth-jwt';
import { isString, isInt, isObject, isUUID } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AppError } from '../../middlewares/error-handler';

class UploadHousingDocumentsDto { roomNumber!: string; }
class HousingDraftDto { version!: number; data!: Record<string, unknown>; roomNumber?: string; }

export class TenantsController {
  static async requestHousingRefund(req: Request, res: Response, next: NextFunction) {
    try {
      const body = requestBody(req.body);
      if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 500)) throw new AppError('เหตุผลคำขอไม่ถูกต้อง', 400);
      if (typeof body.accountName !== 'string' || !body.accountName.trim() || body.accountName.trim().length > 160
        || typeof body.accountNumber !== 'string' || !/^\d{6,20}$/.test(body.accountNumber)) {
        throw new AppError('กรุณาระบุชื่อบัญชีและเลขบัญชีให้ถูกต้อง', 400);
      }
      const result = await HousingRefundService.request((req as AuthenticatedRequest).user!.id,
        body.accountName.trim(), body.accountNumber, typeof body.reason === 'string' ? body.reason : undefined);
      return res.status(200).json(createResponse(200, 'รับคำขอคืนเงินแล้ว', result));
    } catch (error) { next(error); }
  }
  static async listHousingRefunds(_req: Request, res: Response, next: NextFunction) {
    try {
      const rawUserId = _req.query.userId;
      if (rawUserId !== undefined && (typeof rawUserId !== 'string' || !/^\d+$/.test(rawUserId) || Number(rawUserId) < 1)) {
        throw new AppError('Invalid userId filter', 400);
      }
      const userId = typeof rawUserId === 'string' ? Number(rawUserId) : undefined;
      return res.status(200).json(createResponse(200, 'Housing excess and refunds', await HousingRefundService.list(userId)));
    }
    catch (error) { next(error); }
  }
  static async recordHousingRefund(req: Request, res: Response, next: NextFunction) {
    try {
      const body = requestBody(req.body);
      const draftId = Number(req.params.draftId), version = Number(body.version), amount = Number(body.amount);
      if (!isInt(draftId) || draftId < 1 || !isInt(version) || version < 1 || !Number.isFinite(amount)
        || typeof body.reference !== 'string' || !body.reference.trim() || body.reference.length > 100
        || !isUUID(body.idempotencyKey) || body.confirmed !== 'true' || !req.file) throw new AppError('กรุณาระบุยอด เลขอ้างอิง หลักฐาน และยืนยันว่าได้คืนเงินจริงแล้ว', 400);
      const result = await HousingRefundService.record(draftId, (req as AuthenticatedRequest).user!.id,
        { version, amount, reference: body.reference.trim(), idempotencyKey: text(body.idempotencyKey) }, req.file);
      return res.status(200).json(createResponse(200, 'บันทึกการคืนเงินจริงแล้ว', result));
    } catch (error) { next(error); }
  }
  static async getHousingRefundProof(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.refundId);
      if (!isInt(id) || id < 1) throw new AppError('รหัสหลักฐานไม่ถูกต้อง', 400);
      const proof = await HousingRefundService.proof(id);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.sendFile(proof, error => { if (error) next(new AppError('ไม่พบไฟล์หลักฐานคืนเงิน', 404)); });
    } catch (error) { next(error); }
  }
  static async rejectHousingRefund(req: Request, res: Response, next: NextFunction) {
    try {
      const draftId = Number(req.params.draftId), requestId = Number(req.params.requestId);
      const body = requestBody(req.body);
      if (!isInt(draftId) || draftId < 1 || !isInt(requestId) || requestId < 1 || typeof body.note !== 'string') throw new AppError('ข้อมูลการจัดการคำขอไม่ถูกต้อง', 400);
      const result = await HousingRefundService.reject(draftId, requestId, (req as AuthenticatedRequest).user!.id, body.note);
      return res.status(200).json(createResponse(200, 'ปฏิเสธคำขอคืนเงินแล้ว', result));
    } catch (error) { next(error); }
  }
  static async getDraft(req: Request, res: Response, next: NextFunction) {
    try {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(createResponse(200, 'Housing draft restored', await HousingDraftService.get((req as AuthenticatedRequest).user!.id)));
    } catch (error) { next(error); }
  }
  static async saveDraft(req: Request, res: Response, next: NextFunction) {
    try {
      const input = plainToInstance(HousingDraftDto, requestBody(req.body));
      if (!isInt(input.version) || input.version < 1 || !isObject(input.data)
        || input.roomNumber !== undefined && (!isString(input.roomNumber) || input.roomNumber.length > 30)) throw new AppError('Invalid housing draft', 400);
      for (const key of ['personalInformation', 'emergencyContact', 'roomPreference', 'contractData']) {
        const value = input.data[key];
        if (value !== undefined && (!isObject(value) || Object.values(value).some(field => typeof field !== 'string' && typeof field !== 'boolean' || typeof field === 'string' && field.length > 2000))) throw new AppError('Invalid draft fields', 400);
      }
      if (input.data.activeStep !== undefined && (!isInt(input.data.activeStep) || Number(input.data.activeStep) < 0 || Number(input.data.activeStep) > 3)) throw new AppError('Invalid draft step', 400);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(createResponse(200, 'Housing draft saved', await HousingDraftService.save((req as AuthenticatedRequest).user!.id, input.version, input.data, input.roomNumber?.trim())));
    } catch (error) { next(error); }
  }
  static async generateDraftQr(req: Request, res: Response, next: NextFunction) {
    try {
      const input = plainToInstance(UploadHousingDocumentsDto, req.params);
      if (!isString(input.roomNumber) || !input.roomNumber.trim() || input.roomNumber.length > 30) throw new AppError('Invalid room', 400);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(createResponse(200, 'Housing balance QR generated', await HousingPaymentService.generateDraftQr((req as AuthenticatedRequest).user!.id, input.roomNumber.trim())));
    } catch (error) { next(error); }
  }

  static async generatePaymentQr(req: Request, res: Response, next: NextFunction) {
    try {
      const input = plainToInstance(UploadHousingDocumentsDto, req.params);
      if (!isString(input.roomNumber) || !input.roomNumber.trim() || input.roomNumber.length > 30) {
        throw new AppError('กรุณาระบุห้องที่ต้องการชำระมัดจำ', 400);
      }
      const data = await HousingPaymentService.generateDraftQr((req as AuthenticatedRequest).user!.id, input.roomNumber.trim());
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(createResponse(200, 'Housing payment QR generated', data));
    } catch (error) { next(error); }
  }

  static async uploadDocuments(req: Request, res: Response, next: NextFunction) {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const idCardFile = files?.idCard?.[0];
      const paymentSlipFile = files?.paymentSlip?.[0];

      const userId = (req as AuthenticatedRequest).user?.id;
      if (!userId) throw new AppError('กรุณาเข้าสู่ระบบ', 401);
      if (req.path === '/draft/upload-identity' && paymentSlipFile) throw new AppError('ช่องนี้รับเฉพาะบัตรประชาชน', 400);
      if (req.path === '/draft/upload-slip' && idCardFile) throw new AppError('ช่องนี้รับเฉพาะสลิป กรุณาตรวจบัตรในขั้นตอนข้อมูลส่วนตัว', 400);
      if (!idCardFile && !paymentSlipFile) throw new AppError('กรุณาแนบบัตรประชาชนหรือสลิป', 400);
      if (idCardFile && !paymentSlipFile) {
        const data = await TenantsService.verifyIdentity(idCardFile, userId);
        if (req.path === '/draft/upload-identity') await HousingDraftService.bindIdentity(userId, data.ocrData.verificationId!);
        return res.status(200).json(createResponse(200, 'Identity verified', data));
      }
      const input = plainToInstance(UploadHousingDocumentsDto, requestBody(req.body));
      if (!isString(input.roomNumber) || !input.roomNumber.trim() || input.roomNumber.length > 30) throw new AppError('กรุณาระบุห้องที่เลือกก่อนตรวจสอบสลิป', 400);
      const verificationId = Number(requestBody(req.body)?.verificationId);
      if (!idCardFile && (!isInt(verificationId) || verificationId <= 0)) throw new AppError('กรุณาตรวจบัตรประชาชนก่อนตรวจสลิป', 400);
      const data = idCardFile
        ? await TenantsService.uploadDocuments(idCardFile, paymentSlipFile!, userId, input.roomNumber.trim())
        : await TenantsService.verifyHousingPayment(paymentSlipFile!, userId, input.roomNumber.trim(), verificationId, true);
      return res.status(200).json(createResponse(200, 'Documents uploaded successfully', data));
    } catch (error) {
      next(error);
    }
  }
  static async listTenants(req: Request, res: Response, next: NextFunction) {
    try {
      const tenants = await TenantsService.listTenants();
      return res.status(200).json(createResponse(200, 'Tenants fetched successfully', tenants));
    } catch (error) {
      next(error);
    }
  }

  static async getTenantById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid tenant id'));
      }

      const tenant = await TenantsService.getTenantById(id);
      if (!tenant) {
        return res.status(404).json(createResponse(404, 'Tenant not found'));
      }

      return res.status(200).json(createResponse(200, 'Tenant fetched successfully', tenant));
    } catch (error) {
      next(error);
    }
  }

  static async completeFaceEnrollment(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as AuthenticatedRequest).user?.id;
      if (!userId) return res.status(401).json(createResponse(401, 'Authenticated user is required'));
      const result = await TenantsService.completeFaceEnrollment(userId);
      return res.status(200).json(createResponse(200, 'Face enrollment completion saved', result));
    } catch (error) { next(error); }
  }

  static async getMyTenant(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as AuthenticatedRequest).user?.id;
      if (!userId) {
        return res.status(401).json(createResponse(401, 'Authenticated user is required'));
      }

      const tenant = await TenantsService.getTenantByUserId(userId);
      return res.status(200).json(createResponse(200, 'Current tenant status retrieved successfully', tenant));
    } catch (error) {
      next(error);
    }
  }

  static async getMyDocument(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as AuthenticatedRequest).user?.id;
      const documentType = req.params.documentType;
      if (!userId) {
        return res.status(401).json(createResponse(401, 'Authenticated user is required'));
      }

      if (documentType !== 'id-card' && documentType !== 'payment-slip') {
        return res.status(400).json(createResponse(400, 'Unsupported document type'));
      }

      const tenant = await TenantsService.getTenantByUserId(userId);
      if (!tenant) {
        return res.status(404).json(createResponse(404, 'Tenant application not found'));
      }

      if (tenant.status !== 'APPROVED' && tenant.status !== 'ACTIVE') {
        return res.status(403).json(createResponse(403, 'Documents are available after admin approval'));
      }

      const documentPath = documentType === 'id-card' ? tenant.idCardImagePath : tenant.paymentSlipPath;
      const absolutePath = TenantsService.resolveTenantDocumentPath(documentPath);
      return res.sendFile(absolutePath);
    } catch (error) {
      next(error);
    }
  }

  static async getTenantDocumentById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const documentType = req.params.documentType;

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid tenant id'));
      }

      if (documentType !== 'id-card' && documentType !== 'payment-slip') {
        return res.status(400).json(createResponse(400, 'Unsupported document type'));
      }

      const tenant = await TenantsService.getTenantById(id);
      if (!tenant) {
        return res.status(404).json(createResponse(404, 'Tenant not found'));
      }

      const documentPath = documentType === 'id-card' ? tenant.idCardImagePath : tenant.paymentSlipPath;
      if (!documentPath) {
        return res.status(404).json(createResponse(404, 'Document not found for this tenant'));
      }

      const absolutePath = TenantsService.resolveTenantDocumentPath(documentPath);
      return res.sendFile(absolutePath);
    } catch (error) {
      next(error);
    }
  }

  static async createTenant(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = await TenantsService.createTenant(requestBody(req.body));
      return res.status(201).json(createResponse(201, 'Tenant created successfully', tenant));
    } catch (error) {
      next(error);
    }
  }

  static async submitApplication(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as AuthenticatedRequest).user?.id;
      const tenant = await TenantsService.submitApplication({ ...parseHousingApplication(req.body), userId });
      return res.status(201).json(createResponse(201, 'Housing application submitted successfully', tenant));
    } catch (error) {
      next(error);
    }
  }

  static async updateTenant(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid tenant id'));
      }

      const tenant = await TenantsService.updateTenant(id, validateTenantUpdate(requestBody(req.body)));
      return res.status(200).json(createResponse(200, 'Tenant updated successfully', tenant));
    } catch (error) {
      next(error);
    }
  }

  static async deleteTenant(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid tenant id'));
      }

      const result = await TenantsService.deleteTenant(id);
      const status = result.cleanup.status === 'PENDING' ? 202 : 200;
      return res.status(status).json(createResponse(status, status === 202 ? 'ลบข้อมูลส่วนบุคคลแล้ว รอล้างไฟล์และข้อมูลใบหน้า' : 'Tenant deleted successfully', result));
    } catch (error) {
      next(error);
    }
  }
}
