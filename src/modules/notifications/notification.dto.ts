export const validateNotificationPayload = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const body = value as Record<string, unknown>;
  const validChannels = ['SMS', 'EMAIL'];
  const validTypes = ['RENT_DUE', 'RENT_OVERDUE', 'MAINTENANCE_COMPLETED', 'VISITOR_ARRIVAL', 'GENERIC'];

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
  channel: (value: unknown) => typeof value === 'string' && ['SMS', 'EMAIL'].includes(value),
  type: (value: unknown) => typeof value === 'string' && ['RENT_DUE', 'RENT_OVERDUE', 'MAINTENANCE_COMPLETED', 'VISITOR_ARRIVAL', 'GENERIC'].includes(value),
  recipientPhone: (value: unknown) => value === undefined || (typeof value === 'string' && value.trim().length >= 4),
  tenantId: (value: unknown) => value === undefined || (typeof value === 'number' && value > 0),
  payload: (value: unknown) => value === undefined || (typeof value === 'object' && value !== null && !Array.isArray(value)),
};
