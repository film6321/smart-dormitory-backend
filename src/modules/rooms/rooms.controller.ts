import { requestBody, text, optionalText } from '../../shared/input';
import { NextFunction, Request, Response } from 'express';
import { createResponse } from '../../shared/api-response';
import { RoomsService } from './rooms.service';
import { plainToInstance } from 'class-transformer';
import { isNumber, isNumberString, isObject } from 'class-validator';
import { AppError } from '../../middlewares/error-handler';

class RoomPriceDto { monthlyRent?: number | string; }

export class RoomsController {
  static async listRooms(req: Request, res: Response, next: NextFunction) {
    try {
      const rooms = await RoomsService.listRooms();
      return res.status(200).json(createResponse(200, 'Rooms fetched successfully', rooms));
    } catch (error) {
      next(error);
    }
  }

  static async getRoomById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid room id'));
      }

      const room = await RoomsService.getRoomById(id);
      if (!room) {
        return res.status(404).json(createResponse(404, 'Room not found'));
      }

      return res.status(200).json(createResponse(200, 'Room fetched successfully', room));
    } catch (error) {
      next(error);
    }
  }

  static async createRoom(req: Request, res: Response, next: NextFunction) {
    try {
      const body = requestBody(req.body);
      const room = await RoomsService.createRoom({ roomNumber: text(body.roomNumber), monthlyRent: Number(body.monthlyRent),
        floor: body.floor === null ? null : body.floor === undefined ? undefined : Number(body.floor), capacity: body.capacity === undefined ? undefined : Number(body.capacity), status: optionalText(body.status), description: body.description === null ? null : optionalText(body.description) });
      return res.status(201).json(createResponse(201, 'Room created successfully', room));
    } catch (error) {
      next(error);
    }
  }

  static async updateRoom(req: Request, res: Response, next: NextFunction) {
    try {
      if (!isObject(requestBody(req.body))) throw new AppError('ข้อมูลห้องต้องเป็น object', 400);
      const input = plainToInstance(RoomPriceDto, requestBody(req.body));
      if (input.monthlyRent !== undefined && !(isNumber(input.monthlyRent, { allowNaN: false, allowInfinity: false })
        || typeof input.monthlyRent === 'string' && isNumberString(input.monthlyRent))) {
        throw new AppError('ค่าเช่าต้องเป็นตัวเลข', 400);
      }
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid room id'));
      }

      const room = await RoomsService.updateRoom(id, requestBody(req.body));
      return res.status(200).json(createResponse(200, 'Room updated successfully', room));
    } catch (error) {
      next(error);
    }
  }

  static async deleteRoom(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json(createResponse(400, 'Invalid room id'));
      }

      await RoomsService.deleteRoom(id);
      return res.status(200).json(createResponse(200, 'Room deleted successfully'));
    } catch (error) {
      next(error);
    }
  }
}
