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

export const canTransitionBillStatus = (from: string, to: string) => 
  [...billTransitions].some(([f, t]) => f === from && t === to);

export const canTransitionMaintenanceStatus = (from: string, to: string) => 
  [...maintenanceTransitions].some(([f, t]) => f === from && t === to);

export const canTransitionVisitorStatus = (from: string, to: string) => 
  [...visitorTransitions].some(([f, t]) => f === from && t === to);
