export const createMaintenanceTicketSchema = {
  roomId: (value: unknown) => value === undefined || (typeof value === 'number' && value > 0),
  category: (value: unknown) => ['PLUMBING', 'ELECTRICAL', 'CLEANING', 'SECURITY', 'OTHER'].includes(String(value)),
  description: (value: unknown) => typeof value === 'string' && value.trim().length >= 5,
  contactTime: (value: unknown) => value === undefined || typeof value === 'string',
};

export const updateMaintenanceStatusSchema = {
  status: (value: unknown) => ['PENDING', 'APPROVED', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED', 'CLOSED'].includes(String(value)),
  note: (value: unknown) => value === undefined || typeof value === 'string',
};
