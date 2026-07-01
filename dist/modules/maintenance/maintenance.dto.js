"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateMaintenanceStatusSchema = exports.createMaintenanceTicketSchema = void 0;
exports.createMaintenanceTicketSchema = {
    roomId: (value) => value === undefined || (typeof value === 'number' && value > 0),
    category: (value) => ['PLUMBING', 'ELECTRICAL', 'CLEANING', 'SECURITY', 'OTHER'].includes(String(value)),
    description: (value) => typeof value === 'string' && value.trim().length >= 5,
    contactTime: (value) => value === undefined || typeof value === 'string',
};
exports.updateMaintenanceStatusSchema = {
    status: (value) => ['PENDING', 'APPROVED', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED', 'CLOSED'].includes(String(value)),
    note: (value) => value === undefined || typeof value === 'string',
};
