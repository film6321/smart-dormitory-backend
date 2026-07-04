import { prisma } from '../../database/db';
import NotificationService from '../notifications/notification.service';

export class VisitorService {
  static async getVisitorById(id: number) {
    return prisma.visitor.findUnique({ where: { id } });
  }

  static async registerVisitor(data: { guestName: string; purpose?: string; roomId?: number; tenantId?: number; expectedEntryTime?: Date }) {
    const visitor = await prisma.visitor.create({
      data: {
        guestName: data.guestName,
        purpose: data.purpose,
        roomId: data.roomId,
        tenantId: data.tenantId,
        expectedEntryTime: data.expectedEntryTime,
        status: 'REGISTERED',
      },
    });

    const notificationService = new NotificationService();
    await notificationService.scheduleNotification({
      tenantId: visitor.tenantId ?? undefined,
      channel: 'SMS',
      type: 'VISITOR_ARRIVAL',
      payload: JSON.stringify({ message: `Visitor ${visitor.guestName} registered`, visitorId: visitor.id }),
    });

    return visitor;
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
