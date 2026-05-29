"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = exports.AppError = void 0;
const api_response_1 = require("../shared/api-response");
const logger_1 = require("../logger");
class AppError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
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
    return res.status(500).json((0, api_response_1.createResponse)(500, 'Internal Server Error'));
};
exports.errorHandler = errorHandler;
