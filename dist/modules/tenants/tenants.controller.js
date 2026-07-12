"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantsController = void 0;
const api_response_1 = require("../../shared/api-response");
const tenants_service_1 = require("./tenants.service");
class TenantsController {
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
    static async createTenant(req, res, next) {
        try {
            const tenant = await tenants_service_1.TenantsService.createTenant(req.body);
            return res.status(201).json((0, api_response_1.createResponse)(201, 'Tenant created successfully', tenant));
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
