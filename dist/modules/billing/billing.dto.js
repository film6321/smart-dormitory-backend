"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRoomBillSchema = exports.updateBillStatusSchema = exports.uploadSlipSchema = void 0;
exports.uploadSlipSchema = {
    billId: (value) => typeof value === 'number' && value > 0,
    slipHash: (value) => value === undefined || typeof value === 'string',
};
exports.updateBillStatusSchema = {
    status: (value) => typeof value === 'string' && value.trim().length > 0,
    reason: (value) => value === undefined || typeof value === 'string',
};
exports.generateRoomBillSchema = {
    roomNumber: (value) => typeof value === 'string' && value.trim().length > 0,
    electricUnits: (value) => value !== undefined && !isNaN(Number(value)) && Number(value) >= 0,
    waterAmount: (value) => value === undefined || (!isNaN(Number(value)) && Number(value) >= 0),
    dueDate: (value) => value === undefined || typeof value === 'string' || value instanceof Date,
    billingMonth: (value) => value === undefined || typeof value === 'string',
    customRent: (value) => value === undefined || (!isNaN(Number(value)) && Number(value) >= 0),
};
