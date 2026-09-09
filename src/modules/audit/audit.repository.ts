import { prisma } from '../../database/db';

export class AuditRepository {
  static async list(options: { page: number; limit: number; method?: string; userId?: number; from?: Date; to?: Date }) {
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
      prisma.accessLog.findMany({
        where,
        include: { user: { select: { id: true, username: true, email: true, firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (options.page - 1) * options.limit,
        take: options.limit,
      }),
      prisma.accessLog.count({ where }),
    ]);

    return { items, pagination: { page: options.page, limit: options.limit, total, totalPages: Math.ceil(total / options.limit) } };
  }
}
