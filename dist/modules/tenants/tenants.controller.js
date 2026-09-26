"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantsController = void 0;
const api_response_1 = require("../../shared/api-response");
const housing_payment_service_1 = require("./housing-payment.service");
const tenants_service_1 = require("./tenants.service");
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const error_handler_1 = require("../../middlewares/error-handler");
class UploadHousingDocumentsDto {
    roomNumber;
}
class TenantsController {
    static async generatePaymentQr(req, res, next) {
        try {
            const input = (0, class_transformer_1.plainToInstance)(UploadHousingDocumentsDto, req.params);
            if (!(0, class_validator_1.isString)(input.roomNumber) || !input.roomNumber.trim() || input.roomNumber.length > 30) {
                throw new error_handler_1.AppError('กรุณาระบุห้องที่ต้องการชำระมัดจำ', 400);
            }
            const data = await housing_payment_service_1.HousingPaymentService.generateQr(input.roomNumber.trim());
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Housing payment QR generated', data));
        }
        catch (error) {
            next(error);
        }
    }
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
            const userId = req.user?.id;
            if (!userId)
                throw new error_handler_1.AppError('กรุณาเข้าสู่ระบบ', 401);
            const input = (0, class_transformer_1.plainToInstance)(UploadHousingDocumentsDto, req.body);
            if (!(0, class_validator_1.isString)(input.roomNumber) || input.roomNumber.trim().length < 1 || input.roomNumber.trim().length > 30) {
                throw new error_handler_1.AppError('กรุณาระบุห้องที่เลือกก่อนตรวจสอบสลิป', 400);
            }
            const data = await tenants_service_1.TenantsService.uploadDocuments(idCardFile, paymentSlipFile, userId, input.roomNumber.trim());
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Documents uploaded successfully', data));
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
