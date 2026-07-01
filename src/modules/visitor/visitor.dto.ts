export const registerVisitorSchema = {
  guestName: (value: unknown) => typeof value === 'string' && value.trim().length >= 2,
  purpose: (value: unknown) => value === undefined || typeof value === 'string',
  roomId: (value: unknown) => value === undefined || (typeof value === 'number' && value > 0),
  tenantId: (value: unknown) => value === undefined || (typeof value === 'number' && value > 0),
  expectedEntryTime: (value: unknown) => value === undefined || typeof value === 'string',
};

export const updateVisitorStatusSchema = {
  status: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
};
