"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateDto = void 0;
const error_handler_1 = require("../../middlewares/error-handler");
const validateDto = (schema) => {
    return (req, _res, next) => {
        try {
            if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
                return next(new error_handler_1.AppError('Validation Failed', 400, [{ property: 'body', constraints: { isObject: 'Body must be an object' } }]));
            }
            const errors = Object.entries(schema)
                .filter(([property, validator]) => !validator(req.body[property]))
                .map(([property]) => ({ property, constraints: { isValid: `${property} is invalid` } }));
            if (errors.length > 0) {
                return next(new error_handler_1.AppError('Validation Failed', 400, errors));
            }
            next();
        }
        catch (error) {
            next(error);
        }
    };
};
exports.validateDto = validateDto;
