import { Prisma } from '@prisma/client';
import { prisma } from '../../database/db';

export class VisitorRepository {
  static async getVisitorById(id: number, db = prisma) {
    return db.visitor.findUnique({ where: { id } });
  }

  static async registerVisitor(data: Prisma.VisitorCreateInput, db = prisma) {
    return db.visitor.create({ data });
  }

  static async listVisitors(db = prisma) {
    return db.visitor.findMany({
      include: { logs: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async updateVisitorStatus(id: number, data: Prisma.VisitorUpdateInput, db = prisma) {
    return db.visitor.update({ where: { id }, data });
  }
}
