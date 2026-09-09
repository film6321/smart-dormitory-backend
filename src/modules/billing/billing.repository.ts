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
        tenant: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        room: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async findBillById(id: number, db = prisma) {
    return db.bill.findUnique({
      where: { id },
      include: {
        tenant: {
          include: {
            user: true,
          },
        },
        room: true,
      },
    });
  }

  static async findRoomByNumberWithTenants(roomNumber: string, db = prisma) {
    return db.room.findUnique({
      where: { roomNumber: roomNumber.trim().toUpperCase() },
      include: {
        tenants: {
          where: { isActive: true },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });
  }

  static async createBills(bills: Array<{
    tenantId: number;
    roomId: number;
    amount: number;
    rentAmount?: number;
    electricAmount?: number;
    waterAmount?: number;
    penaltyAmount?: number;
    dueDate: Date;
    description?: string;
  }>, db = prisma) {
    return db.$transaction(
      bills.map((bill) =>
        db.bill.create({
          data: {
            tenantId: bill.tenantId,
            roomId: bill.roomId,
            amount: bill.amount,
            rentAmount: bill.rentAmount ?? 0,
            electricAmount: bill.electricAmount ?? 0,
            waterAmount: bill.waterAmount ?? 0,
            penaltyAmount: bill.penaltyAmount ?? 0,
            dueDate: bill.dueDate,
            description: bill.description,
            status: 'UNPAID',
          },
          include: {
            tenant: {
              include: {
                user: true,
              },
            },
            room: true,
          },
        })
      )
    );
  }

  static async updateBill(id: number, data: Prisma.BillUpdateInput, db = prisma) {
    return db.bill.update({
      where: { id },
      data,
      include: {
        tenant: {
          include: {
            user: true,
          },
        },
        room: true,
      },
    });
  }

  static async deleteBill(id: number, db = prisma) {
    return db.$transaction(async (transaction) => {
      await transaction.paymentBatchItem.deleteMany({ where: { billId: id } });
      await transaction.payment.deleteMany({ where: { billId: id } });
      return transaction.bill.delete({ where: { id } });
    });
  }
}

