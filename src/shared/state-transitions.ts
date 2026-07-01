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

export const canTransitionBillStatus = (from: string, to: string) => billTransitions.has([from, to] as [string, string]);
export const canTransitionMaintenanceStatus = (from: string, to: string) => maintenanceTransitions.has([from, to] as [string, string]);
export const canTransitionVisitorStatus = (from: string, to: string) => visitorTransitions.has([from, to] as [string, string]);
