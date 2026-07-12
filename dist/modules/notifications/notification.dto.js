"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNotificationSchema = exports.validateNotificationPayload = void 0;
const validateNotificationPayload = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const body = value;
    const validChannels = ['SMS', 'EMAIL'];
    const validTypes = ['RENT_DUE', 'RENT_OVERDUE', 'MAINTENANCE_COMPLETED', 'VISITOR_ARRIVAL', 'GENERIC'];
    if (typeof body.channel !== 'string' || !validChannels.includes(body.channel)) {
        return false;
    }
    if (typeof body.type !== 'string' || !validTypes.includes(body.type)) {
        return false;
    }
    if (typeof body.recipientPhone !== 'string' || body.recipientPhone.trim().length < 4) {
        return false;
    }
    if (body.tenantId !== undefined && (typeof body.tenantId !== 'number' || body.tenantId <= 0)) {
        return false;
    }
    if (body.payload !== undefined && (typeof body.payload !== 'object' || body.payload === null || Array.isArray(body.payload))) {
        return false;
    }
    return true;
};
exports.validateNotificationPayload = validateNotificationPayload;
exports.createNotificationSchema = {
    channel: (value) => typeof value === 'string' && ['SMS', 'EMAIL'].includes(value),
    type: (value) => typeof value === 'string' && ['RENT_DUE', 'RENT_OVERDUE', 'MAINTENANCE_COMPLETED', 'VISITOR_ARRIVAL', 'GENERIC'].includes(value),
    recipientPhone: (value) => value === undefined || (typeof value === 'string' && value.trim().length >= 4),
    tenantId: (value) => value === undefined || (typeof value === 'number' && value > 0),
    payload: (value) => value === undefined || (typeof value === 'object' && value !== null && !Array.isArray(value)),
};
