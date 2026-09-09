"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditService = void 0;
const audit_repository_1 = require("./audit.repository");
class AuditService {
    static async list(query) {
        const page = Number.isInteger(query.page) && query.page && query.page > 0 ? query.page : 1;
        const limit = Number.isInteger(query.limit) && query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 25;
        const from = query.from ? new Date(query.from) : undefined;
        const to = query.to ? new Date(query.to) : undefined;
        if (from && Number.isNaN(from.getTime()))
            throw new Error('Invalid from date');
        if (to && Number.isNaN(to.getTime()))
            throw new Error('Invalid to date');
        return audit_repository_1.AuditRepository.list({ page, limit, method: query.method?.trim().toUpperCase() || undefined, userId: query.userId, from, to });
    }
}
exports.AuditService = AuditService;
