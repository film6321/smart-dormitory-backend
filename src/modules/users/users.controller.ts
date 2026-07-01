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
}
