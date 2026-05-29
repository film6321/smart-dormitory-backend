"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getJwtSecret = void 0;
const error_handler_1 = require("../middlewares/error-handler");
const getJwtSecret = () => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new error_handler_1.AppError('JWT_SECRET is not configured', 500);
    }
    return secret;
};
exports.getJwtSecret = getJwtSecret;
