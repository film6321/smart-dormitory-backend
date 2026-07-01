"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateBillStatusSchema = exports.uploadSlipSchema = void 0;
exports.uploadSlipSchema = {
    billId: (value) => typeof value === 'number' && value > 0,
    slipHash: (value) => value === undefined || typeof value === 'string',
};
exports.updateBillStatusSchema = {
    status: (value) => typeof value === 'string' && value.trim().length > 0,
    reason: (value) => value === undefined || typeof value === 'string',
};
