import { requestBody, text, optionalText } from '../../shared/input';
import { NextFunction, Request, Response } from 'express';
import { createResponse } from '../../shared/api-response';
import { UsersService } from './users.service';
import { AuthenticatedRequest } from '../../middlewares/auth-jwt';
import { PrivacyConsentService } from './privacy-consent.service';

export class UsersController {
  static async getPrivacyConsent(req: Request, res: Response, next: NextFunction) {
    try {
      const purpose = PrivacyConsentService.purpose(req.params.purpose);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(createResponse(200, 'Privacy notice fetched',
        await PrivacyConsentService.get((req as AuthenticatedRequest).user!.id, purpose)));
    } catch (error) { next(error); }
  }
  static async acceptPrivacyConsent(req: Request, res: Response, next: NextFunction) {
    try {
      return res.status(200).json(createResponse(200, 'Privacy consent recorded',
        await PrivacyConsentService.accept((req as AuthenticatedRequest).user!.id, requestBody(req.body))));
    } catch (error) { next(error); }
  }
  static async listUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const users = await UsersService.listUsers();
      return res.status(200).json(createResponse(200, 'Users fetched successfully', users));
    } catch (error) {
      next(error);
    }
  }

  static async getUserById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid user id'));
      }

      const user = await UsersService.getUserById(id);
      if (!user) {
        return res.status(404).json(createResponse(404, 'User not found'));
      }

      return res.status(200).json(createResponse(200, 'User fetched successfully', user));
    } catch (error) {
      next(error);
    }
  }

  static async createUser(req: Request, res: Response, next: NextFunction) {
    try {
      UsersService.validatePhone(requestBody(req.body));
      const body = requestBody(req.body);
      const user = await UsersService.createUser({ email: text(body.email), password: text(body.password), username: optionalText(body.username), phone: body.phone === null ? null : optionalText(body.phone), role: optionalText(body.role) });
      return res.status(201).json(createResponse(201, 'User created successfully', user));
    } catch (error) {
      next(error);
    }
  }

  static async updateUser(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid user id'));
      }

      UsersService.validatePhone(requestBody(req.body));
      const body = requestBody(req.body);
      const user = await UsersService.updateUser(id, { email: optionalText(body.email), password: optionalText(body.password), username: optionalText(body.username), phone: body.phone === null ? null : optionalText(body.phone), role: optionalText(body.role) });
      return res.status(200).json(createResponse(200, 'User updated successfully', user));
    } catch (error) {
      next(error);
    }
  }

  static async deleteUser(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid user id'));
      }

      const result = await UsersService.deleteUser(id);
      const status = result.cleanup.status === 'PENDING' ? 202 : 200;
      return res.status(status).json(createResponse(status, status === 202 ? 'ลบข้อมูลส่วนบุคคลแล้ว รอล้างไฟล์และข้อมูลใบหน้า' : 'User deleted successfully', result));
    } catch (error) {
      next(error);
    }
  }
}
