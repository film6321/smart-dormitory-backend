export const validateNotificationPayload = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const body = value as Record<string, unknown>;
  const validChannels = ['SMS', 'EMAIL', 'IN_APP'];
  const validTypes = ['RENT_DUE', 'RENT_OVERDUE', 'MAINTENANCE_COMPLETED', 'VISITOR_ARRIVAL', 'GENERIC', 'HOUSING_REFUND'];

  if (typeof body.channel !== 'string' || !validChannels.includes(body.channel)) {
    return false;
  }

  if (typeof body.type !== 'string' || !validTypes.includes(body.type)) {
    return false;
  }

  if (typeof body.recipientPhone !== 'string' || body.recipientPhone.trim().length < 4) {
    return false;
  }

  if (body.tenantId !== undefined && (typeof body.tenantId !== 'number' || body.tenantId <= 0)) {
    return false;
  }

  if (body.payload !== undefined && (typeof body.payload !== 'object' || body.payload === null || Array.isArray(body.payload))) {
    return false;
  }

  return true;
};

export const createNotificationSchema = {
  channel: (value: unknown) => typeof value === 'string' && ['SMS', 'EMAIL', 'IN_APP'].includes(value),
  type: (value: unknown) => typeof value === 'string' && ['RENT_DUE', 'RENT_OVERDUE', 'MAINTENANCE_COMPLETED', 'VISITOR_ARRIVAL', 'GENERIC', 'HOUSING_REFUND'].includes(value),
  recipientPhone: (value: unknown) => value === undefined || (typeof value === 'string' && value.trim().length >= 4),
  tenantId: (value: unknown) => value === undefined || (typeof value === 'number' && value > 0),
  payload: (value: unknown) => value === undefined || (typeof value === 'object' && value !== null && !Array.isArray(value)),
};
import { NotificationChannel, NotificationType } from '@prisma/client';
import { AppError } from '../../middlewares/error-handler';

export const parseNotificationChannel = (value: string): NotificationChannel => {
  const channel = Object.values(NotificationChannel).find(item => item === value);
  if (!channel) throw new AppError('Invalid notification channel', 400);
  return channel;
};

export const parseNotificationType = (value: string): NotificationType => {
  const type = Object.values(NotificationType).find(item => item === value);
  if (!type) throw new AppError('Invalid notification type', 400);
  return type;
};
