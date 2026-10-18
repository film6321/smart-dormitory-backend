import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AnalyticsService } from '../../src/modules/analytics/analytics.service';
import { DbClient } from '../../src/database/db';
import { Prisma } from '@prisma/client';

describe('AnalyticsService (unit)', () => {
  it('groups recorded resident scans on Bangkok dates and fills days without scans', async () => {
    const db = { $queryRaw: async (sql: TemplateStringsArray, start: Date, until: Date) => {
      assert.ok(sql.join('').includes("a.method = 'FACE_GATE'"));
      assert.ok(sql.join('').includes("u.role = 'STUDENT'"));
      assert.equal(start.toISOString(), '2026-09-12T17:00:00.000Z');
      assert.equal(until.toISOString(), '2026-10-12T17:00:00.000Z');
      return [{ day: '2026-10-12', entries: 3, exits: 1 }];
    } } as unknown as DbClient;
    const days = await AnalyticsService.getDailyAccessAnalytics(db, new Date('2026-10-11T18:00:00Z'));
    assert.equal(days.length, 30);
    assert.deepEqual(days[0], { date: '2026-09-13', entries: 0, exits: 0 });
    assert.deepEqual(days[29], { date: '2026-10-12', entries: 3, exits: 1 });
  });
  it('returns dashboard analytics with system and dormitory metrics', async (t) => {
    t.mock.method(AnalyticsService, 'getBusinessAnalytics', async () => ({
      totals: { billPaid: 0, depositPaid: 0, received: 0, outstanding: 0, receivedThisMonth: 0, undatedReceived: 0 },
      perRoom: [], monthlyReceipts: [], housingPayments: [],
      urgent: { overdueBills: 0, waitingVisitors: 0, paidAwaitingApplication: 0, paidAwaitingAdminApproval: 0, housingPaymentsNeedReview: 0 }, activity: [],
    }));
    t.mock.method(AnalyticsService, 'getDailyAccessAnalytics', async () => []);
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
  it('rejects malformed external metrics rather than treating null or objects as zero', async t => {
    for (const sample of [null, { metric: { status_code: '200' }, value: [1, null] }, { metric: { status_code: {} }, value: [1, '4'] }]) {
      t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ status: 'success', data: { result: [sample] } })));
      const result = await AnalyticsService.getObservabilityAnalytics();
      assert.equal(result.metricsAvailable, false);
      assert.equal(result.http, null);
      t.mock.restoreAll();
    }
  });
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


describe('business financial analytics', () => {
  it('counts a paid bill once, separates deposits, keeps unassigned balances and uses receipt dates', async () => {
    const date = (value: string) => new Date(value);
    const db = {
      room: { findMany: async () => [{ id: 1, roomNumber: '100' }] },
      bill: { findMany: async () => [
        { id: 1, roomId: 1, amount: '100.25', status: 'PAID', paidAt: date('2026-11-01'), dueDate: date('2025-01-01'), batchItems: [{ batch: { transferAt: date('2026-10-01') } }] },
        { id: 2, roomId: null, amount: '20.10', status: 'UNPAID', paidAt: null, dueDate: date('2020-01-01') },
        { id: 3, roomId: 1, amount: '5.15', status: 'PAID', paidAt: null, dueDate: date('2026-10-01') },
        { id: 4, roomId: 1, amount: '30', status: 'VERIFYING', paidAt: null, dueDate: date('2020-01-01') },
      ] },
      payment: { findMany: async (args: Prisma.PaymentFindManyArgs) => {
        assert.equal(args.where?.billId, null); assert.equal(args.where?.status, 'PAID');
        return [{ id: 1, housingRoomId: 1, amount: '200.10', housingApprovedAt: date('2026-10-02'), transferAt: date('2026-09-01'), verifiedAt: date('2026-10-01') }];
      } },
      visitor: { count: async (args: Prisma.VisitorCountArgs) => { assert.equal(args.where?.status, 'REGISTERED'); assert.ok(args.where?.OR); return 2; } },
      tenant: { findMany: async () => [] },
      maintenanceTicket: { findMany: async () => [] },
    } as unknown as DbClient;
    const result = await AnalyticsService.getBusinessAnalytics(db);
    assert.equal(result.totals.received, 305.5);
    assert.equal(result.totals.undatedReceived, 5.15);
    assert.equal(result.perRoom.find(r => r.roomId === 1)?.depositPaid, 200.1);
    assert.equal(result.perRoom.find(r => r.roomId === null)?.outstanding, 20.1);
    assert.equal(result.monthlyReceipts[0].month, '2026-09');
    assert.equal(result.monthlyReceipts[1].billPaid, 100.25);
    assert.equal(result.urgent.overdueBills, 1);
    assert.equal(result.urgent.waitingVisitors, 2);
    assert.ok(!JSON.stringify(result).includes('providerResponse'));
  });
});


describe('housing payment ownership', () => {
  it('separates paid attempts awaiting application, retained ledgers and unlinked records without deleting money', async () => {
    const db = {
      room: { findMany: async () => [{ id: 1, roomNumber: '100' }] },
      bill: { findMany: async () => [] },
      payment: { findMany: async () => [
        { id: 1, housingRoomId: 1, housingTenantId: null, payerUserId: 5, payerUser: { username: 'fixture' }, housingTenant: null, amount: '100', verifiedAt: new Date('2026-10-01'), transferAt: null },
        { id: 2, housingRoomId: 1, housingTenantId: 7, payerUserId: null, payerUser: null, housingTenant: { status: 'ARCHIVED' }, amount: '100', verifiedAt: null, transferAt: null },
        { id: 3, housingRoomId: 1, housingTenantId: null, payerUserId: null, payerUser: null, housingTenant: null, amount: '100', verifiedAt: null, transferAt: null },
        { id: 4, housingRoomId: 1, housingTenantId: 8, housingApprovedAt: null, payerUserId: 5, payerUser: { username: 'fixture' }, housingTenant: { status: 'PENDING' }, amount: '100', verifiedAt: new Date('2026-10-01'), transferAt: null },
      ] },
      tenant: { findMany: async (args: Prisma.TenantFindManyArgs) => { assert.deepEqual(args.where?.status, { not: 'ARCHIVED' }); return []; } },
      visitor: { count: async () => 0 },
      maintenanceTicket: { findMany: async (args: Prisma.MaintenanceTicketFindManyArgs) => { assert.deepEqual(args.where?.tenant, { status: { not: 'ARCHIVED' } }); return []; } },
    } as unknown as DbClient;
    const result = await AnalyticsService.getBusinessAnalytics(db);
    assert.equal(result.totals.depositPaid, 0);
    assert.equal(result.urgent.paidAwaitingApplication, 1);
    assert.equal(result.urgent.housingPaymentsNeedReview, 1);
    assert.deepEqual(result.housingPayments.map(p => p.state), ['AWAITING_APPLICATION', 'RETAINED_HISTORY', 'NEEDS_REVIEW', 'AWAITING_ADMIN_APPROVAL']);
    assert.equal(result.urgent.paidAwaitingAdminApproval, 1);
    assert.equal(result.monthlyReceipts.length, 0);
  });
});
