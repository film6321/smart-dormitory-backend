import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AnalyticsService } from '../../src/modules/analytics/analytics.service';
import { DbClient } from '../../src/database/db';
import { Prisma } from '@prisma/client';

describe('AnalyticsService (unit)', () => {
  it('returns dashboard analytics with system and dormitory metrics', async () => {
    // Mock db client
    const mockDb = {
      room: {
        count: async (args?: Prisma.RoomCountArgs) => {
          if (typeof args?.where?.status === 'string' && args.where.status === 'OCCUPIED') return 5;
          return 10;
        },
      },
      tenant: {
        count: async (args?: Prisma.TenantCountArgs) => {
          if (typeof args?.where?.status === 'string' && args.where.status === 'PENDING') return 2;
          return 8;
        },
      },
      bill: {
        aggregate: async (args?: Prisma.BillAggregateArgs) => {
          if (args?.where?.status === 'PAID') {
            return { _count: { id: 12 }, _sum: { amount: new Prisma.Decimal(36000) } };
          }
          return { _count: { id: 3 }, _sum: { amount: new Prisma.Decimal(9000) } };
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
        count: async (args?: Prisma.VisitorCountArgs) => {
          if (args?.where?.status === 'CHECKED_IN') return 1;
          if (args?.where?.status === 'CHECKED_OUT') return 3;
          return 4;
        },
      },
    } as unknown as DbClient;

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


describe('observability analytics', () => {
  it('groups HTTP statuses and returns security counters without querying dormitory data', async (t) => {
    t.mock.method(AnalyticsService, 'getDashboardAnalytics', () => { throw new Error('Database must not be queried'); });
    t.mock.method(globalThis, 'fetch', async (input: string) => {
      const query = new URL(input).searchParams.get('query') ?? '';
      const result = query.includes('http_requests')
        ? [{ metric: { status_code: '200' }, value: [1, '4'] }, { metric: { status_code: '201' }, value: [1, '2'] }, { metric: { status_code: '404' }, value: [1, '3'] }]
        : [{ metric: { outcome: query.includes('auth_login') ? 'success' : 'matched' }, value: [1, '5'] }];
      return new Response(JSON.stringify({ status: 'success', data: { result } }));
    });
    const result = await AnalyticsService.getObservabilityAnalytics();
    assert.deepEqual(result.http, { '2xx': 6, '3xx': 0, '4xx': 3, '5xx': 0 });
    assert.equal(result.security?.login.success, 5);
    assert.equal(result.security?.faceVerification.matched, 5);
    assert.equal(result.metricsAvailable, true);
    assert.ok(result.system.memoryUsageMb.rss > 0);
  });

  it('preserves valid zero counters as available data', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
      status: 'success', data: { result: [{ metric: { status_code: '200', outcome: 'success' }, value: [1, '0'] }] },
    })));
    const result = await AnalyticsService.getObservabilityAnalytics();
    assert.equal(result.metricsAvailable, true);
    assert.equal(result.http?.['2xx'], 0);
    assert.equal(result.security?.login.success, 0);
  });

  it('reports absent time series as unavailable instead of zero', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ status: 'success', data: { result: [] } })));
    const result = await AnalyticsService.getObservabilityAnalytics();
    assert.equal(result.metricsAvailable, false);
    assert.equal(result.http, null);
    assert.equal(result.security, null);
    assert.ok(result.system.memoryUsageMb.rss > 0);
  });

  it('still returns memory when the metrics server fails', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('Metrics unavailable'); });
    const result = await AnalyticsService.getObservabilityAnalytics();
    assert.equal(result.metricsAvailable, false);
    assert.equal(result.metricsSource, 'unavailable');
    assert.equal(result.http, null);
    assert.equal(result.security, null);
    assert.ok(result.system.memoryUsageMb.rss > 0);
  });
});
