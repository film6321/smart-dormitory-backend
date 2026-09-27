"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = exports.AppError = void 0;
const client_1 = require("@prisma/client");
const api_response_1 = require("../shared/api-response");
const logger_1 = require("../logger");
class AppError extends Error {
    statusCode;
    details;
    constructor(message, statusCode, details) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.AppError = AppError;
const errorHandler = (err, _req, res, _next) => {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger_1.logger.error({ err }, message);
    if (err instanceof AppError) {
        return res.status(err.statusCode).json((0, api_response_1.createResponse)(err.statusCode, err.message));
    }
    if (_req.method === 'DELETE' && err instanceof client_1.Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2003')
            return res.status(409).json((0, api_response_1.createResponse)(409, 'ลบไม่ได้ เนื่องจากมีข้อมูลที่เกี่ยวข้องหรือประวัติที่ต้องเก็บรักษา'));
        if (err.code === 'P2025')
            return res.status(404).json((0, api_response_1.createResponse)(404, 'ไม่พบข้อมูลที่ต้องการลบ'));
        if (err.code === 'P2034')
            return res.status(409).json((0, api_response_1.createResponse)(409, 'ข้อมูลกำลังถูกแก้ไข กรุณาลองใหม่'));
    }
    return res.status(500).json((0, api_response_1.createResponse)(500, 'Internal Server Error'));
};
exports.errorHandler = errorHandler;
