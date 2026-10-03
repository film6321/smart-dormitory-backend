import { MaintenanceCategory, MaintenanceStatus } from '@prisma/client';

export const createMaintenanceTicketSchema = {
  roomId: (value: unknown) => value === undefined || (typeof value === 'number' && value > 0),
  category: (value: unknown) => typeof value === 'string' && Object.values(MaintenanceCategory).some((category) => category === value),
  description: (value: unknown) => typeof value === 'string' && value.trim().length >= 5,
  contactTime: (value: unknown) => value === undefined || typeof value === 'string',
};

export const updateMaintenanceStatusSchema = {
  status: (value: unknown) => typeof value === 'string' && Object.values(MaintenanceStatus).some((status) => status === value),
  note: (value: unknown) => value === undefined || typeof value === 'string',
};
