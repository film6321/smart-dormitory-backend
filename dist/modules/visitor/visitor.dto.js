"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateVisitorStatusSchema = exports.cancelVisitorSchema = exports.registerVisitorSchema = exports.scanVisitorIdCardSchema = void 0;
exports.scanVisitorIdCardSchema = {
    imageBase64: (value) => typeof value === 'string' && value.trim().length > 0,
};
exports.registerVisitorSchema = {
    guestName: (value) => typeof value === 'string' && value.trim().length >= 2,
    phone: (value) => value === undefined || value === null || value === '' || typeof value === 'string',
    citizenId: (value) => value === undefined || value === null || value === '' || typeof value === 'string',
    relationship: (value) => value === undefined || value === null || value === '' || typeof value === 'string',
    age: (value) => value === undefined || value === null || (typeof value === 'number' && value >= 0) || (typeof value === 'string' && !isNaN(Number(value))),
    birthDate: (value) => value === undefined || value === null || value === '' || typeof value === 'string',
    address: (value) => value === undefined || value === null || value === '' || typeof value === 'string',
    idCardImagePath: (value) => value === undefined || value === null || value === '' || typeof value === 'string',
    purpose: (value) => value === undefined || value === null || value === '' || typeof value === 'string',
    roomId: (value) => value === undefined || value === null || value === '' || typeof value === 'number' || typeof value === 'string',
    roomNumber: (value) => value === undefined || value === null || value === '' || typeof value === 'string',
    tenantId: (value) => value === undefined || value === null || value === '' || typeof value === 'number' || typeof value === 'string',
    tenantName: (value) => value === undefined || value === null || value === '' || typeof value === 'string',
    expectedEntryTime: (value) => value === undefined || value === null || value === '' || typeof value === 'string',
    pdpaConsent: (value) => value === true || value === 'true',
};
exports.cancelVisitorSchema = {
    reason: (value) => value === undefined || value === null || typeof value === 'string',
};
exports.updateVisitorStatusSchema = {
    status: (value) => typeof value === 'string' && value.trim().length > 0,
};
