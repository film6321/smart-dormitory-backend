import NotificationService from '../notifications/notification.service';
import { AppError } from '../../middlewares/error-handler';
import { getSettingValue } from '../settings/settings.service';
import { VisitorRepository } from './visitor.repository';
import { Prisma, VisitorStatus } from '@prisma/client';
import { prisma } from '../../database/db';
import { publishAdminAlert } from '../../realtime/notification-gateway';

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
    const now = new Date();
    if (status === 'CHECKED_IN') {
      const checkInTime = await getSettingValue('checkInTime');
      const checkOutTime = await getSettingValue('checkOutTime');
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const [checkInHour, checkInMinute] = checkInTime.split(':').map(Number);
      const [checkOutHour, checkOutMinute] = checkOutTime.split(':').map(Number);
      const start = checkInHour * 60 + checkInMinute;
      const end = checkOutHour * 60 + checkOutMinute;
      const isWithinWindow = start <= end
        ? currentMinutes >= start && currentMinutes <= end
        : currentMinutes >= start || currentMinutes <= end;
      if (!Number.isFinite(start) || !Number.isFinite(end) || !isWithinWindow) {
        throw new AppError(`Check-in เปิดให้บริการเวลา ${checkInTime} - ${checkOutTime}`, 409);
      }
    }
    const data: Prisma.VisitorUpdateInput = {
      status: status as unknown as VisitorStatus,
    };

    if (status === 'CHECKED_IN') data.checkedInAt = now;
    if (status === 'CHECKED_OUT') data.checkedOutAt = now;

    const visitor = await prisma.$transaction(async (transaction) => {
      const updated = await VisitorRepository.updateVisitorStatus(id, data, transaction);
      await transaction.visitorLog.create({
        data: {
          visitorId: id,
          eventType: status,
          note: status === 'CHECKED_IN' ? 'ผู้มาติดต่อเข้าหอพัก' : status === 'CHECKED_OUT' ? 'ผู้มาติดต่อออกจากหอพัก' : undefined,
        },
      });
      return updated;
    });

    const actionLabel = status === 'CHECKED_IN' ? 'Check-in' : status === 'CHECKED_OUT' ? 'Check-out' : `เปลี่ยนสถานะเป็น ${status}`;
    publishAdminAlert(visitor.id, 'VISITOR_STATUS', `ผู้มาติดต่อ ${visitor.guestName}: ${actionLabel}`, status);

    return visitor;
  }
}
