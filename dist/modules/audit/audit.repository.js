"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditRepository = void 0;
const db_1 = require("../../database/db");
class AuditRepository {
    static async list(options) {
        const where = {
            ...(options.method ? { method: options.method } : {}),
            ...(options.userId ? { userId: options.userId } : {}),
            ...((options.from || options.to) ? {
                createdAt: {
                    ...(options.from ? { gte: options.from } : {}),
                    ...(options.to ? { lte: options.to } : {}),
                },
            } : {}),
        };
        const [items, total] = await Promise.all([
            db_1.prisma.accessLog.findMany({
                where,
                include: { user: { select: { id: true, username: true, email: true, firstName: true, lastName: true } } },
                orderBy: { createdAt: 'desc' },
                skip: (options.page - 1) * options.limit,
                take: options.limit,
            }),
            db_1.prisma.accessLog.count({ where }),
        ]);
        return { items, pagination: { page: options.page, limit: options.limit, total, totalPages: Math.ceil(total / options.limit) } };
    }
}
exports.AuditRepository = AuditRepository;
