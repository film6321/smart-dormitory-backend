"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canTransitionVisitorStatus = exports.canTransitionMaintenanceStatus = exports.canTransitionBillStatus = void 0;
const billTransitions = new Set([
    ['UNPAID', 'VERIFYING'],
    ['UNPAID', 'OVERDUE'],
    ['OVERDUE', 'VERIFYING'],
    ['VERIFYING', 'PAID'],
    ['VERIFYING', 'FAILED'],
    ['FAILED', 'UNPAID'],
    ['FAILED', 'OVERDUE'],
]);
const maintenanceTransitions = new Set([
    ['PENDING', 'APPROVED'],
    ['PENDING', 'CANCELLED'],
    ['APPROVED', 'IN_PROGRESS'],
    ['APPROVED', 'CANCELLED'],
    ['IN_PROGRESS', 'RESOLVED'],
    ['IN_PROGRESS', 'CANCELLED'],
    ['RESOLVED', 'CLOSED'],
]);
const visitorTransitions = new Set([
    ['REGISTERED', 'VERIFYING'],
    ['REGISTERED', 'EXPIRED'],
    ['VERIFYING', 'APPROVED'],
    ['VERIFYING', 'REJECTED'],
    ['APPROVED', 'CHECKED_IN'],
    ['REJECTED', 'REGISTERED'],
    ['REJECTED', 'EXPIRED'],
    ['CHECKED_IN', 'CHECKED_OUT'],
    ['CHECKED_IN', 'EXPIRED'],
]);
const canTransitionBillStatus = (from, to) => billTransitions.has([from, to]);
exports.canTransitionBillStatus = canTransitionBillStatus;
const canTransitionMaintenanceStatus = (from, to) => maintenanceTransitions.has([from, to]);
exports.canTransitionMaintenanceStatus = canTransitionMaintenanceStatus;
const canTransitionVisitorStatus = (from, to) => visitorTransitions.has([from, to]);
exports.canTransitionVisitorStatus = canTransitionVisitorStatus;
