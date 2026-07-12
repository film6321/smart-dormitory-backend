import { Prisma } from '@prisma/client';
import { prisma } from '../../database/db';

export class BillingRepository {
  static async listBills(userId?: number, role?: string, db = prisma) {
    const where = role === 'ADMIN'
      ? {}
      : { tenant: { userId } };

    return db.bill.findMany({
      where,
      include: {
        tenant: true,
        room: true,
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  static async findBillById(id: number, db = prisma) {
    return db.bill.findUnique({ where: { id } });
  }

  static async updateBill(id: number, data: Prisma.BillUpdateInput, db = prisma) {
    return db.bill.update({ where: { id }, data });
  }
}
