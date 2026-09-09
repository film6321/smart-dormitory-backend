"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditController = void 0;
const error_handler_1 = require("../../middlewares/error-handler");
const api_response_1 = require("../../shared/api-response");
const audit_service_1 = require("./audit.service");
class AuditController {
    static async list(req, res, next) {
        try {
            const page = Number(req.query.page ?? 1);
            const limit = Number(req.query.limit ?? 25);
            const userId = req.query.userId === undefined ? undefined : Number(req.query.userId);
            if (!Number.isInteger(page) || page <= 0 || !Number.isInteger(limit) || limit <= 0 || limit > 100) {
                return next(new error_handler_1.AppError('Invalid pagination parameters', 400));
            }
            if (userId !== undefined && (!Number.isInteger(userId) || userId <= 0)) {
                return next(new error_handler_1.AppError('Invalid user id', 400));
            }
            const data = await audit_service_1.AuditService.list({
                page,
                limit,
                userId,
                method: typeof req.query.method === 'string' ? req.query.method : undefined,
                from: typeof req.query.from === 'string' ? req.query.from : undefined,
                to: typeof req.query.to === 'string' ? req.query.to : undefined,
            });
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Audit logs retrieved', data));
        }
        catch (error) {
            next(error);
        }
    }
}
exports.AuditController = AuditController;
