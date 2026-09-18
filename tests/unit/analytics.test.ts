import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AnalyticsService } from '../../src/modules/analytics/analytics.service';

describe('AnalyticsService (unit)', () => {
  it('returns dashboard analytics with system and dormitory metrics', async () => {
    // Mock db client
    const mockDb: any = {
      room: {
        count: async ({ where }: any = {}) => {
          if (where?.status === 'OCCUPIED') return 5;
          return 10;
        },
      },
      tenant: {
        count: async ({ where }: any = {}) => {
          if (where?.status === 'PENDING') return 2;
          return 8;
        },
      },
      bill: {
        aggregate: async ({ where }: any = {}) => {
          if (where?.status === 'PAID') {
            return { _count: { id: 12 }, _sum: { amount: 36000 } };
          }
          return { _count: { id: 3 }, _sum: { amount: 9000 } };
        },
      },
      maintenanceTicket: {
        groupBy: async () => [
          { status: 'PENDING', _count: { id: 1 } },
          { status: 'IN_PROGRESS', _count: { id: 2 } },
          { status: 'RESOLVED', _count: { id: 5 } },
        ],
      },
      visitor: {
        count: async ({ where }: any = {}) => {
          if (where?.status === 'CHECKED_IN') return 1;
          if (where?.status === 'CHECKED_OUT') return 3;
          return 4;
        },
      },
    };

    const result = await AnalyticsService.getDashboardAnalytics(mockDb);

    assert.ok(result.system);
    assert.ok(result.dormitory);
    assert.equal(result.dormitory.rooms.total, 10);
    assert.equal(result.dormitory.rooms.occupied, 5);
    assert.equal(result.dormitory.rooms.available, 5);
    assert.equal(result.dormitory.rooms.occupancyRate, 50);
    assert.equal(result.dormitory.tenants.totalActive, 8);
    assert.equal(result.dormitory.tenants.pendingApplications, 2);
    assert.equal(result.dormitory.billing.unpaidCount, 3);
    assert.equal(result.dormitory.billing.paidCount, 12);
    assert.equal(result.dormitory.billing.totalPaidAmount, 36000);
    assert.equal(result.dormitory.maintenance.pending, 1);
    assert.equal(result.dormitory.maintenance.inProgress, 2);
    assert.equal(result.dormitory.maintenance.resolved, 5);
    assert.equal(result.dormitory.visitors.currentlyCheckedIn, 1);
  });
});
