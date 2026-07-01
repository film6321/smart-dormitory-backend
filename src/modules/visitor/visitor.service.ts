import { prisma } from '../../database/db';

export class VisitorService {
  static async getVisitorById(id: number) {
    return prisma.visitor.findUnique({ where: { id } });
  }

  static async registerVisitor(data: { guestName: string; purpose?: string; roomId?: number; tenantId?: number; expectedEntryTime?: Date }) {
    return prisma.visitor.create({
      data: {
        guestName: data.guestName,
        purpose: data.purpose,
        roomId: data.roomId,
        tenantId: data.tenantId,
        expectedEntryTime: data.expectedEntryTime,
        status: 'REGISTERED',
      },
    });
  }

  static async listVisitors() {
    return prisma.visitor.findMany({
      include: { logs: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async updateVisitorStatus(id: number, status: string) {
    return prisma.visitor.update({
      where: { id },
      data: {
        status: status as any,
      },
    });
  }
}
