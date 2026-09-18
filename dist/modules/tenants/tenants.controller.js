"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantsController = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const api_response_1 = require("../../shared/api-response");
const tenants_service_1 = require("./tenants.service");
const ocr_service_1 = require("../ocr/ocr.service");
const error_handler_1 = require("../../middlewares/error-handler");
const logger_1 = require("../../logger");
class TenantsController {
    static async uploadDocuments(req, res, next) {
        try {
            const files = req.files;
            const idCardFile = files?.idCard?.[0];
            const paymentSlipFile = files?.paymentSlip?.[0];
            if (!idCardFile) {
                throw new error_handler_1.AppError('isThaiIdCard or idCard file is required', 400);
            }
            if (!paymentSlipFile) {
                throw new error_handler_1.AppError('paymentSlip file is required', 400);
            }
            const uploadRoot = path.resolve(process.env.UPLOAD_ROOT || path.join(process.cwd(), 'uploads/private'));
            const idCardsDir = path.join(uploadRoot, 'id-cards');
            const slipsDir = path.join(uploadRoot, 'payment-slips');
            if (!fs.existsSync(idCardsDir))
                fs.mkdirSync(idCardsDir, { recursive: true });
            if (!fs.existsSync(slipsDir))
                fs.mkdirSync(slipsDir, { recursive: true });
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
            let ocrData = null;
            try {
                const base64Str = `data:${idCardFile.mimetype};base64,${idCardFile.buffer.toString('base64')}`;
                const userId = req.user?.id;
                ocrData = await ocr_service_1.OcrService.verifyIdCard(base64Str, { userId });
            }
            catch (ocrErr) {
                logger_1.logger.warn({ err: ocrErr }, 'OCR processing failed inside document upload, proceeding with fallback');
            }
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Documents uploaded successfully', {
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
        }
        catch (error) {
            next(error);
        }
    }
    static async listTenants(req, res, next) {
        try {
            const tenants = await tenants_service_1.TenantsService.listTenants();
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Tenants fetched successfully', tenants));
        }
        catch (error) {
            next(error);
        }
    }
    static async getTenantById(req, res, next) {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid tenant id'));
            }
            const tenant = await tenants_service_1.TenantsService.getTenantById(id);
            if (!tenant) {
                return res.status(404).json((0, api_response_1.createResponse)(404, 'Tenant not found'));
            }
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Tenant fetched successfully', tenant));
        }
        catch (error) {
            next(error);
        }
    }
    static async getMyTenant(req, res, next) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json((0, api_response_1.createResponse)(401, 'Authenticated user is required'));
            }
            const tenant = await tenants_service_1.TenantsService.getTenantByUserId(userId);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Current tenant status retrieved successfully', tenant));
        }
        catch (error) {
            next(error);
        }
    }
    static async getMyDocument(req, res, next) {
        try {
            const userId = req.user?.id;
            const documentType = req.params.documentType;
            if (!userId) {
                return res.status(401).json((0, api_response_1.createResponse)(401, 'Authenticated user is required'));
            }
            if (documentType !== 'id-card' && documentType !== 'payment-slip') {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Unsupported document type'));
            }
            const tenant = await tenants_service_1.TenantsService.getTenantByUserId(userId);
            if (!tenant) {
                return res.status(404).json((0, api_response_1.createResponse)(404, 'Tenant application not found'));
            }
            if (tenant.status !== 'APPROVED' && tenant.status !== 'ACTIVE') {
                return res.status(403).json((0, api_response_1.createResponse)(403, 'Documents are available after admin approval'));
            }
            const documentPath = documentType === 'id-card' ? tenant.idCardImagePath : tenant.paymentSlipPath;
            const absolutePath = tenants_service_1.TenantsService.resolveTenantDocumentPath(documentPath);
            return res.sendFile(absolutePath);
        }
        catch (error) {
            next(error);
        }
    }
    static async getTenantDocumentById(req, res, next) {
        try {
            const id = Number(req.params.id);
            const documentType = req.params.documentType;
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid tenant id'));
            }
            if (documentType !== 'id-card' && documentType !== 'payment-slip') {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Unsupported document type'));
            }
            const tenant = await tenants_service_1.TenantsService.getTenantById(id);
            if (!tenant) {
                return res.status(404).json((0, api_response_1.createResponse)(404, 'Tenant not found'));
            }
            const documentPath = documentType === 'id-card' ? tenant.idCardImagePath : tenant.paymentSlipPath;
            if (!documentPath) {
                return res.status(404).json((0, api_response_1.createResponse)(404, 'Document not found for this tenant'));
            }
            const absolutePath = tenants_service_1.TenantsService.resolveTenantDocumentPath(documentPath);
            return res.sendFile(absolutePath);
        }
        catch (error) {
            next(error);
        }
    }
    static async createTenant(req, res, next) {
        try {
            const tenant = await tenants_service_1.TenantsService.createTenant(req.body);
            return res.status(201).json((0, api_response_1.createResponse)(201, 'Tenant created successfully', tenant));
        }
        catch (error) {
            next(error);
        }
    }
    static async submitApplication(req, res, next) {
        try {
            const userId = req.user?.id;
            const tenant = await tenants_service_1.TenantsService.submitApplication({ ...req.body, userId });
            return res.status(201).json((0, api_response_1.createResponse)(201, 'Housing application submitted successfully', tenant));
        }
        catch (error) {
            next(error);
        }
    }
    static async updateTenant(req, res, next) {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid tenant id'));
            }
            const tenant = await tenants_service_1.TenantsService.updateTenant(id, req.body);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Tenant updated successfully', tenant));
        }
        catch (error) {
            next(error);
        }
    }
    static async deleteTenant(req, res, next) {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid tenant id'));
            }
            await tenants_service_1.TenantsService.deleteTenant(id);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Tenant deleted successfully'));
        }
        catch (error) {
            next(error);
        }
    }
}
exports.TenantsController = TenantsController;
