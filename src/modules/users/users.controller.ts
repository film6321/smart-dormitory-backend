import { NextFunction, Request, Response } from 'express';
import { createResponse } from '../../shared/api-response';
import { UsersService } from './users.service';

export class UsersController {
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
      UsersService.validatePhone(req.body);
      const user = await UsersService.createUser(req.body);
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

      UsersService.validatePhone(req.body);
      const user = await UsersService.updateUser(id, req.body);
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
