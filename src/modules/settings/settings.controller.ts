import { NextFunction, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth-jwt';
import { createResponse } from '../../shared/api-response';
import { SettingsService } from './settings.service';
import { plainToInstance } from 'class-transformer';
import { isObject, isString, isInt, isBoolean, isIn } from 'class-validator';
import { AcademicService, type AcademicChange } from './academic.service';
import { AppError } from '../../middlewares/error-handler';

class SettingsRequestDto { [key: string]: string; }

export class SettingsController {
  static async academics(req: Request, res: Response, next: NextFunction) {
    try { return res.json(createResponse(200, 'Academic catalogue', await AcademicService.get((req as AuthenticatedRequest).user!.role === 'ADMIN'))); }
    catch (error) { next(error); }
  }
  static async changeAcademic(req: Request, res: Response, next: NextFunction) {
    try {
      if (!isObject(req.body)) throw new AppError('Invalid academic request', 400);
      const input = plainToInstance(SettingsRequestDto, req.body) as unknown as AcademicChange;
      if (!isInt(input.revision) || input.revision < 0 || !isIn(input.action, ['SAVE', 'DELETE']) || !isIn(input.kind, ['FACULTY', 'PROGRAM'])
        || Object.keys(input).some(field => !['revision', 'action', 'kind', 'id', 'name', 'facultyId', 'active'].includes(field))
        || ['id', 'name', 'facultyId'].some(field => input[field as 'id'] !== undefined && !isString(input[field as 'id']))
        || input.active !== undefined && !isBoolean(input.active)) throw new AppError('Invalid academic request', 400);
      return res.json(createResponse(200, 'Academic catalogue saved', await AcademicService.change(input, (req as AuthenticatedRequest).user!.id)));
    } catch (error) { next(error); }
  }
  static async get(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await SettingsService.get();
      return res.status(200).json(createResponse(200, 'System settings fetched successfully', data));
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      if (!isObject(req.body)) throw new AppError('ข้อมูลการตั้งค่าต้องเป็น object', 400);
      const input = plainToInstance(SettingsRequestDto, req.body);
      if (Object.values(input).some(value => !isString(value))) throw new AppError('ค่าการตั้งค่าต้องเป็นข้อความ', 400);
      const userId = (req as AuthenticatedRequest).user!.id;
      const data = await SettingsService.update(input, userId);
      return res.status(200).json(createResponse(200, 'System settings updated successfully', data));
    } catch (error) {
      next(error);
    }
  }
}
