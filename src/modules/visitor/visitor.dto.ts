export const scanVisitorIdCardSchema = {
  imageBase64: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
};

export const registerVisitorSchema = {
  guestName: (value: unknown) => typeof value === 'string' && value.trim().length >= 2,
  phone: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'string',
  citizenId: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'string',
  relationship: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'string',
  age: (value: unknown) => value === undefined || value === null || (typeof value === 'number' && value >= 0) || (typeof value === 'string' && !isNaN(Number(value))),
  birthDate: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'string',
  address: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'string',
  idCardImagePath: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'string',
  purpose: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'string',
  roomId: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'number' || typeof value === 'string',
  roomNumber: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'string',
  tenantId: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'number' || typeof value === 'string',
  tenantName: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'string',
  expectedEntryTime: (value: unknown) => value === undefined || value === null || value === '' || typeof value === 'string',
  pdpaConsent: (value: unknown) => value === true || value === 'true',
};

export const cancelVisitorSchema = {
  reason: (value: unknown) => value === undefined || value === null || typeof value === 'string',
};

export const updateVisitorStatusSchema = {
  status: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
};

