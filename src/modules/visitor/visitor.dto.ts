import { isISO8601, IsIn, Equals } from 'class-validator';

export class VisitorAccessDto {
  action!: 'GRANT_ENTRY' | 'COMPLETE_VISIT';
  detailsConfirmed!: boolean;
}
IsIn(['GRANT_ENTRY', 'COMPLETE_VISIT'])(VisitorAccessDto.prototype, 'action');
Equals(true)(VisitorAccessDto.prototype, 'detailsConfirmed');

export const scanVisitorIdCardSchema = {
  imageBase64: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
};

export const registerVisitorSchema = {
  guestName: (value: unknown) => typeof value === 'string' && value.trim().length >= 2,
  citizenId: (value: unknown) => typeof value === 'string' && /^\d{13}$/.test(value.replace(/\D/g, '')),
  address: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
  roomNumber: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
  requestedTenantName: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
  idCardImagePath: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
  idCardVerificationId: (value: unknown) => Number.isInteger(Number(value)) && Number(value) > 0,
  phone: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'string',
  relationship: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'string',
  age: (value: unknown) => value === undefined || value === null || ((typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 120),
  birthDate: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'string',
  purpose: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'string',
  expectedEntryTime: (value: unknown) => value === undefined || value === null || value === '' || (typeof value === 'string' && isISO8601(value, { strict: true, strictSeparator: true }) && Number.isFinite(new Date(value).getTime())),
  pdpaConsent: (value: unknown) => value === true || value === 'true',
};

export const cancelVisitorSchema = {
  reason: (value: unknown) => value === undefined || value === null || typeof value === 'string',
};

export const updateVisitorStatusSchema = {
  status: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
};
