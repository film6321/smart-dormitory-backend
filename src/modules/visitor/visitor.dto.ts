export const scanVisitorIdCardSchema = {
  imageBase64: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
};

export const registerVisitorSchema = {
  guestName: (value: unknown) => typeof value === 'string' && value.trim().length >= 2,
  citizenId: (value: unknown) => typeof value === 'string' && /^\d{13}$/.test(value.replace(/\D/g, '')),
  address: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
  roomNumber: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
  tenantName: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
  idCardImagePath: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
  idCardVerificationId: (value: unknown) => Number.isInteger(Number(value)) && Number(value) > 0,
  phone: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'string',
  relationship: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'string',
  age: (value: unknown) => value === undefined || value === null || (typeof value === 'number' && value >= 0) || (typeof value === 'string' && !isNaN(Number(value))),
  birthDate: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'string',
  purpose: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'string',
  expectedEntryTime: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'string',
  pdpaConsent: (value: unknown) => value === true || value === 'true',
};

export const cancelVisitorSchema = {
  reason: (value: unknown) => value === undefined || value === null || typeof value === 'string',
};

export const updateVisitorStatusSchema = {
  status: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
};
