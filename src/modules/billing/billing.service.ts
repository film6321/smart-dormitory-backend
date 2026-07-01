import { prisma } from '../../database/db';
import { AppError } from '../../middlewares/error-handler';

export class BillingService {
  static async listBills(userId?: number, role?: string) {
    const where = role === 'ADMIN'
      ? {}
      : { tenant: { userId } };

    return prisma.bill.findMany({
      where,
      include: {
        tenant: true,
        room: true,
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  static async getBillById(id: number) {
    return prisma.bill.findUnique({ where: { id } });
  }

  static async uploadSlip(billId: number, slipHash: string) {
    const bill = await prisma.bill.findUnique({ where: { id: billId } });
    if (!bill) {
      throw new AppError('Bill not found', 404);
    }

    return prisma.bill.update({
      where: { id: billId },
      data: {
        status: 'VERIFYING',
        slipHash,
        reason: 'OCR pending',
        version: bill.version + 1,
      },
    });
  }

  static async updateBillStatus(billId: number, status: string, reason?: string) {
    return prisma.bill.update({
      where: { id: billId },
      data: {
        status: status as any,
        reason,
        version: { increment: 1 },
      },
    });
  }
}
