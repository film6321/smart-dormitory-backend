"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateVisitorStatusSchema = exports.registerVisitorSchema = void 0;
exports.registerVisitorSchema = {
    guestName: (value) => typeof value === 'string' && value.trim().length >= 2,
    purpose: (value) => value === undefined || typeof value === 'string',
    roomId: (value) => value === undefined || (typeof value === 'number' && value > 0),
    tenantId: (value) => value === undefined || (typeof value === 'number' && value > 0),
    expectedEntryTime: (value) => value === undefined || typeof value === 'string',
};
exports.updateVisitorStatusSchema = {
    status: (value) => typeof value === 'string' && value.trim().length > 0,
};
