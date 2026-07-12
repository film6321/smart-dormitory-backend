import { NextFunction, Request, Response } from 'express';
import { createResponse } from '../../shared/api-response';
import { TenantsService } from './tenants.service';

export class TenantsController {
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

  static async createTenant(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = await TenantsService.createTenant(req.body);
      return res.status(201).json(createResponse(201, 'Tenant created successfully', tenant));
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
