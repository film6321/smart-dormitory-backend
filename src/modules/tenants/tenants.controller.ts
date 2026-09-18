import * as fs from 'fs';
import * as path from 'path';
import { NextFunction, Request, Response } from 'express';
import { createResponse } from '../../shared/api-response';
import { TenantsService } from './tenants.service';
import { OcrService } from '../ocr/ocr.service';
import { AuthenticatedRequest } from '../../middlewares/auth-jwt';
import { AppError } from '../../middlewares/error-handler';
import { logger } from '../../logger';

export class TenantsController {
  static async uploadDocuments(req: Request, res: Response, next: NextFunction) {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const idCardFile = files?.idCard?.[0];
      const paymentSlipFile = files?.paymentSlip?.[0];

      if (!idCardFile) {
        throw new AppError('isThaiIdCard or idCard file is required', 400);
      }
      if (!paymentSlipFile) {
        throw new AppError('paymentSlip file is required', 400);
      }

      const uploadRoot = path.resolve(process.env.UPLOAD_ROOT || path.join(process.cwd(), 'uploads/private'));
      const idCardsDir = path.join(uploadRoot, 'id-cards');
      const slipsDir = path.join(uploadRoot, 'payment-slips');

      if (!fs.existsSync(idCardsDir)) fs.mkdirSync(idCardsDir, { recursive: true });
      if (!fs.existsSync(slipsDir)) fs.mkdirSync(slipsDir, { recursive: true });

      const safeIdCardName = path.basename(idCardFile.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
      const idCardName = `${Date.now()}-idcard-${safeIdCardName}`;
      const idCardPath = path.join(idCardsDir, idCardName);
      await fs.promises.writeFile(idCardPath, idCardFile.buffer);

      const safeSlipName = path.basename(paymentSlipFile.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
      const slipName = `${Date.now()}-slip-${safeSlipName}`;
      const slipPath = path.join(slipsDir, slipName);
      await fs.promises.writeFile(slipPath, paymentSlipFile.buffer);

      const idCardImagePath = `uploads/private/id-cards/${idCardName}`;
      const paymentSlipPath = `uploads/private/payment-slips/${slipName}`;

      let ocrData: Awaited<ReturnType<typeof OcrService.verifyIdCard>> | null = null;
      try {
        const base64Str = `data:${idCardFile.mimetype};base64,${idCardFile.buffer.toString('base64')}`;
        const userId = (req as AuthenticatedRequest).user?.id;
        ocrData = await OcrService.verifyIdCard(base64Str, { userId });
      } catch (ocrErr) {
        logger.warn({ err: ocrErr }, 'OCR processing failed inside document upload, proceeding with fallback');
      }

      return res.status(200).json(createResponse(200, 'Documents uploaded successfully', {
        idCardImagePath,
        paymentSlipPath,
        ocrData: {
          citizenId: ocrData?.citizenId ? `********${ocrData.citizenId.slice(-4)}` : '',
          fullNameTh: ocrData?.fullNameTh || '',
          birthDateTh: ocrData?.birthDateTh || '',
          age: ocrData?.age ?? null,
          address: ocrData?.address || '',
          isThaiIdCard: Boolean(ocrData?.isThaiIdCard),
        }
      }));
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
      const tenant = await TenantsService.createTenant(req.body);
      return res.status(201).json(createResponse(201, 'Tenant created successfully', tenant));
    } catch (error) {
      next(error);
    }
  }

  static async submitApplication(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as AuthenticatedRequest).user?.id;
      const tenant = await TenantsService.submitApplication({ ...req.body, userId });
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

      const tenant = await TenantsService.updateTenant(id, req.body);
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

      await TenantsService.deleteTenant(id);
      return res.status(200).json(createResponse(200, 'Tenant deleted successfully'));
    } catch (error) {
      next(error);
    }
  }
}
