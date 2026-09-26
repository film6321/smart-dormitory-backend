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
    // Revert transitions (for correction)
    ['APPROVED', 'PENDING'],
    ['IN_PROGRESS', 'APPROVED'],
    ['RESOLVED', 'IN_PROGRESS'],
    ['CLOSED', 'RESOLVED'],
    ['CANCELLED', 'PENDING'],
]);
const visitorTransitions = new Set([
    ['REGISTERED', 'VERIFYING'],
    ['REGISTERED', 'CANCELLED'],
    ['REGISTERED', 'EXPIRED'],
    ['VERIFYING', 'APPROVED'],
    ['VERIFYING', 'REJECTED'],
    ['VERIFYING', 'CANCELLED'],
    ['VERIFYING', 'EXPIRED'],
    ['APPROVED', 'CHECKED_IN'],
    ['APPROVED', 'CANCELLED'],
    ['APPROVED', 'EXPIRED'],
    ['REJECTED', 'REGISTERED'],
    ['REJECTED', 'EXPIRED'],
    ['CHECKED_IN', 'CHECKED_OUT'],
    ['CHECKED_IN', 'EXPIRED'],
]);
const canTransitionBillStatus = (from, to) => [...billTransitions].some(([f, t]) => f === from && t === to);
exports.canTransitionBillStatus = canTransitionBillStatus;
const canTransitionMaintenanceStatus = (from, to) => [...maintenanceTransitions].some(([f, t]) => f === from && t === to);
exports.canTransitionMaintenanceStatus = canTransitionMaintenanceStatus;
const canTransitionVisitorStatus = (from, to) => [...visitorTransitions].some(([f, t]) => f === from && t === to);
exports.canTransitionVisitorStatus = canTransitionVisitorStatus;
