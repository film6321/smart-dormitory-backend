export const uploadSlipSchema = {
  billId: (value: unknown) => typeof value === 'number' && value > 0,
  slipHash: (value: unknown) => value === undefined || typeof value === 'string',
};

export const updateBillStatusSchema = {
  status: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
  reason: (value: unknown) => value === undefined || typeof value === 'string',
};
