export const uploadSlipSchema = {
  billId: (value: unknown) => typeof value === 'number' && value > 0,
  slipHash: (value: unknown) => value === undefined || typeof value === 'string',
};

export const updateBillStatusSchema = {
  status: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
  reason: (value: unknown) => value === undefined || typeof value === 'string',
};

export const generateRoomBillSchema = {
  roomNumber: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
  electricUnits: (value: unknown) => value !== undefined && !isNaN(Number(value)) && Number(value) >= 0,
  waterAmount: (value: unknown) => value === undefined || (!isNaN(Number(value)) && Number(value) >= 0),
  dueDate: (value: unknown) => value === undefined || typeof value === 'string' || value instanceof Date,
  billingMonth: (value: unknown) => value === undefined || typeof value === 'string',
  customRent: (value: unknown) => value === undefined || (!isNaN(Number(value)) && Number(value) >= 0),
};

