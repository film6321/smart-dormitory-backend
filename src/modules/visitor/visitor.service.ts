import NotificationService from '../notifications/notification.service';
import { VisitorRepository } from './visitor.repository';
import { Prisma, VisitorStatus } from '@prisma/client';

export class VisitorService {
  static async getVisitorById(id: number) {
    return VisitorRepository.getVisitorById(id);
  }

  static async registerVisitor(data: { guestName: string; purpose?: string; roomId?: number; tenantId?: number; expectedEntryTime?: Date }) {
    const createData: any = {
      guestName: data.guestName,
      purpose: data.purpose,
      expectedEntryTime: data.expectedEntryTime,
      status: 'REGISTERED',
    };
    if (data.roomId !== undefined && data.roomId !== null) createData.room = { connect: { id: data.roomId } };
    if (data.tenantId !== undefined && data.tenantId !== null) createData.tenant = { connect: { id: data.tenantId } };

    const visitor = await VisitorRepository.registerVisitor(createData);

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
    return VisitorRepository.listVisitors();
  }

  static async updateVisitorStatus(id: number, status: string) {
    return VisitorRepository.updateVisitorStatus(id, {
      status: status as unknown as VisitorStatus,
    });
  }
}
