import os from 'os';
import promClient from 'prom-client';
import { prisma, type DbClient } from '../../database/db';

type MetricBreakdown = Record<string, number>;

export interface ObservabilityAnalyticsResponse {
  system: SystemAnalytics;
  http: MetricBreakdown | null;
  security: {
    login: MetricBreakdown;
    faceVerification: MetricBreakdown;
  } | null;
  metricsAvailable: boolean;
  metricsSource: 'prometheus' | 'unavailable';
  timestamp: string;
}

interface PrometheusQueryResponse {
  status: 'success' | 'error';
  data?: { result?: Array<{ metric?: Record<string, string>; value?: [number, string] }> };
}

export interface SystemAnalytics {
  uptimeSeconds: number;
  memoryUsageMb: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  cpu: {
    cores: number;
    model: string;
    loadAverage: number[];
  };
  nodeVersion: string;
  platform: string;
}

export interface DormitoryAnalytics {
  rooms: {
    total: number;
    available: number;
    occupied: number;
    occupancyRate: number;
  };
  tenants: {
    totalActive: number;
    pendingApplications: number;
  };
  billing: {
    unpaidCount: number;
    paidCount: number;
    totalUnpaidAmount: number;
    totalPaidAmount: number;
  };
  maintenance: {
    pending: number;
    inProgress: number;
    resolved: number;
  };
  visitors: {
    registeredToday: number;
    currentlyCheckedIn: number;
    checkedOutToday: number;
  };
}

export interface DashboardAnalyticsResponse {
  system: SystemAnalytics;
  dormitory: DormitoryAnalytics;
  business: Awaited<ReturnType<typeof AnalyticsService.getBusinessAnalytics>>;
  dailyAccess: Awaited<ReturnType<typeof AnalyticsService.getDailyAccessAnalytics>>;
  timestamp: string;
}

export class AnalyticsService {
  static async getDailyAccessAnalytics(db: DbClient = prisma, now = new Date()) {
    const dayKey = (date: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    const end = new Date(dayKey(now) + 'T00:00:00+07:00');
    const start = new Date(end.getTime() - 29 * 86400000);
    const until = new Date(end.getTime() + 86400000);
    const rows = await db.$queryRaw<Array<{ day: string; entries: number; exits: number }>>`
      SELECT to_char(a."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS day,
        count(*) FILTER (WHERE a.path = 'IN')::int AS entries,
        count(*) FILTER (WHERE a.path = 'OUT')::int AS exits
      FROM "AccessLog" a JOIN "User" u ON u.id = a."userId"
      WHERE a.method = 'FACE_GATE' AND a.path IN ('IN', 'OUT') AND u.role = 'STUDENT'
        AND a."createdAt" >= ${start} AND a."createdAt" < ${until}
      GROUP BY day ORDER BY day`;
    const counts = new Map(rows.map(row => [row.day, row]));
    return Array.from({ length: 30 }, (_, index) => {
      const date = dayKey(new Date(start.getTime() + index * 86400000));
      const row = counts.get(date);
      return { date, entries: row?.entries ?? 0, exits: row?.exits ?? 0 };
    });
  }

  private static getSystemAnalytics(): SystemAnalytics {
    const mem = process.memoryUsage();
    const system: SystemAnalytics = {
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsageMb: {
        rss: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
        heapTotal: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
        heapUsed: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
        external: Math.round((mem.external / 1024 / 1024) * 100) / 100,
      },
      cpu: {
        cores: os.cpus().length,
        model: os.cpus()[0]?.model || 'Generic CPU',
        loadAverage: os.loadavg().map((l) => Math.round(l * 100) / 100),
      },
      nodeVersion: process.version,
      platform: process.platform,
    };

    return system;
  }

  static async getDashboardAnalytics(db: DbClient = prisma): Promise<DashboardAnalyticsResponse> {
    const system = this.getSystemAnalytics();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      totalRooms,
      occupiedRooms,
      totalActiveTenants,
      pendingTenants,
      unpaidBills,
      paidBills,
      maintenanceTickets,
      visitorsToday,
      currentlyCheckedInVisitors,
      checkedOutVisitorsToday,
    ] = await Promise.all([
      db.room.count(),
      db.room.count({ where: { status: 'OCCUPIED' } }),
      db.tenant.count({ where: { isActive: true, status: { in: ['APPROVED', 'ACTIVE'] } } }),
      db.tenant.count({ where: { status: 'PENDING' } }),
      db.bill.aggregate({
        where: { status: { in: ['UNPAID', 'OVERDUE'] } },
        _count: { id: true },
        _sum: { amount: true },
      }),
      db.bill.aggregate({
        where: { status: 'PAID' },
        _count: { id: true },
        _sum: { amount: true },
      }),
      db.maintenanceTicket.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      db.visitor.count({ where: { createdAt: { gte: startOfToday } } }),
      db.visitor.count({ where: { status: 'CHECKED_IN' } }),
      db.visitor.count({
        where: {
          status: 'CHECKED_OUT',
          checkedOutAt: { gte: startOfToday },
        },
      }),
    ]);

    const maintenanceMap: Record<string, number> = {};
    for (const item of maintenanceTickets) {
      maintenanceMap[item.status] = item._count.id;
    }

    const occupancyRate = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 1000) / 10 : 0;

    const dormitory: DormitoryAnalytics = {
      rooms: {
        total: totalRooms,
        available: Math.max(0, totalRooms - occupiedRooms),
        occupied: occupiedRooms,
        occupancyRate,
      },
      tenants: {
        totalActive: totalActiveTenants,
        pendingApplications: pendingTenants,
      },
      billing: {
        unpaidCount: unpaidBills._count.id || 0,
        paidCount: paidBills._count.id || 0,
        totalUnpaidAmount: Number(unpaidBills._sum.amount || 0),
        totalPaidAmount: Number(paidBills._sum.amount || 0),
      },
      maintenance: {
        pending: maintenanceMap['PENDING'] || 0,
        inProgress: maintenanceMap['IN_PROGRESS'] || 0,
        resolved: (maintenanceMap['RESOLVED'] || 0) + (maintenanceMap['CLOSED'] || 0),
      },
      visitors: {
        registeredToday: visitorsToday,
        currentlyCheckedIn: currentlyCheckedInVisitors,
        checkedOutToday: checkedOutVisitorsToday,
      },
    };

    return {
      system,
      dormitory,
      business: await this.getBusinessAnalytics(db),
      dailyAccess: await this.getDailyAccessAnalytics(db),
      timestamp: new Date().toISOString(),
    };
  }

  static async getBusinessAnalytics(db: DbClient = prisma) {
    const now = new Date();
    const [rooms, bills, deposits, waitingVisitors, applications, moveOuts, repairs] = await Promise.all([
      db.room.findMany({ select: { id: true, roomNumber: true } }),
      db.bill.findMany({ where: { status: { in: ['PAID', 'UNPAID', 'OVERDUE', 'VERIFYING'] } },
        select: { id: true, roomId: true, amount: true, status: true, paidAt: true, dueDate: true,
          payments: { where: { status: 'PAID' }, orderBy: { verifiedAt: 'desc' }, take: 1, select: { transferAt: true } },
          batchItems: { where: { batch: { status: 'PAID' } }, orderBy: { createdAt: 'desc' }, take: 1, select: { batch: { select: { transferAt: true } } } },
        } }),
      // Bill payments are deliberately excluded: each PAID bill is counted once above,
      // including bills paid in a batch. A housing deposit is its own payment ledger.
      db.payment.findMany({ where: { status: 'PAID', billId: null, housingRoomId: { not: null } },
        select: { id: true, housingDraft: { select: { roomId: true } }, housingRoomId: true, housingTenantId: true, housingApprovedAt: true, payerUserId: true, housingTenant: { select: { status: true } }, payerUser: { select: { username: true } }, amount: true, transferAt: true, verifiedAt: true } }),
      db.visitor.count({ where: { status: 'REGISTERED', logs: { none: { eventType: 'DOOR_ACCESS_GRANTED' } }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
      db.tenant.findMany({ where: { status: { not: 'ARCHIVED' } }, orderBy: { createdAt: 'desc' }, take: 12,
        select: { id: true, createdAt: true, roomId: true, user: { select: { username: true } } } }),
      db.tenant.findMany({ where: { status: { not: 'ARCHIVED' }, checkOutDate: { not: null } }, orderBy: { checkOutDate: 'desc' }, take: 12,
        select: { id: true, checkOutDate: true, roomId: true, user: { select: { username: true } } } }),
      db.maintenanceTicket.findMany({ where: { tenant: { status: { not: 'ARCHIVED' } } }, orderBy: { updatedAt: 'desc' }, take: 24,
        select: { id: true, createdAt: true, resolvedAt: true, roomId: true } }),
    ]);
    type Row = { roomId: number | null; roomNumber: string; billPaid: number; depositPaid: number; outstanding: number; received: number };
    const rows = new Map<number | null, Row>(rooms.map(r => [r.id, {
      roomId: r.id, roomNumber: r.roomNumber, billPaid: 0, depositPaid: 0, outstanding: 0, received: 0,
    }]));
    const row = (id: number | null) => {
      if (!rows.has(id)) rows.set(id, { roomId: id, roomNumber: 'ไม่ผูกห้อง', billPaid: 0, depositPaid: 0, outstanding: 0, received: 0 });
      return rows.get(id)!;
    };
    // Sum integer satang, then convert once; do not round each receipt to whole baht.
    const satang = (value: unknown) => Math.round(Number(value) * 100);
    const monthKey = (date: Date) => new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', timeZone: 'Asia/Bangkok' }).format(date);
    const months = new Map<string, { month: string; billPaid: number; depositPaid: number }>();
    let undatedReceived = 0;
    const activity: { id: string; title: string; occurredAt: string; href: string }[] = [];
    const event = (id: string, title: string, date: Date | null, href: string) => {
      if (date && Number.isFinite(date.getTime())) activity.push({ id, title, occurredAt: date.toISOString(), href });
    };
    const receipt = (amount: number, date: Date | null, kind: 'billPaid' | 'depositPaid') => {
      if (!date || !Number.isFinite(date.getTime())) { undatedReceived += amount; return; }
      const key = monthKey(date);
      const bucket = months.get(key) || { month: key, billPaid: 0, depositPaid: 0 };
      bucket[kind] += amount; months.set(key, bucket);
    };
    let overdueCount = 0;
    for (const bill of bills) {
      const amount = satang(bill.amount), target = row(bill.roomId);
      if (bill.status === 'PAID') {
        const date = bill.payments?.[0]?.transferAt || bill.batchItems?.[0]?.batch.transferAt || bill.paidAt;
        target.billPaid += amount; receipt(amount, date, 'billPaid');
        event('bill-' + bill.id, 'บันทึกชำระบิล #' + bill.id, bill.paidAt, '/income-expenses');
      } else {
        target.outstanding += amount;
        if (bill.status !== 'VERIFYING' && bill.dueDate < now) overdueCount++;
      }
    }
    const housingPayments: { id: number; roomNumber: string; amount: number; state: string; username: string | null }[] = [];
    for (const deposit of deposits) {
      const amount = satang(deposit.amount), date = deposit.transferAt || deposit.verifiedAt;
      const state = deposit.housingApprovedAt ? 'ADMIN_CONFIRMED' : deposit.housingTenantId
        ? deposit.housingTenant?.status === 'ARCHIVED' ? 'RETAINED_HISTORY' : 'AWAITING_ADMIN_APPROVAL'
        : deposit.payerUserId && deposit.payerUser ? 'AWAITING_APPLICATION' : 'NEEDS_REVIEW';
      housingPayments.push({ id: deposit.id, roomNumber: row(deposit.housingDraft?.roomId ?? deposit.housingRoomId).roomNumber,
        amount: amount / 100, state, username: deposit.payerUser?.username || null });
      // Verified transfer alone is not counted until the Admin confirms the application.
      if (!deposit.housingApprovedAt) continue;
      row(deposit.housingDraft?.roomId ?? deposit.housingRoomId).depositPaid += amount; receipt(amount, date, 'depositPaid');
      event('deposit-' + deposit.id, 'รับเงินมัดจำห้อง ' + row(deposit.housingDraft?.roomId ?? deposit.housingRoomId).roomNumber, date, '/reports');
    }
    for (const tenant of applications) event('application-' + tenant.id,
      'สมัครเข้าพัก · ' + (tenant.user?.username || 'ผู้สมัคร #' + tenant.id), tenant.createdAt, '/students');
    for (const tenant of moveOuts) event('moveout-' + tenant.id,
      'ย้ายออกตามวันที่บันทึก · ' + (tenant.user?.username || 'ผู้พัก #' + tenant.id), tenant.checkOutDate, '/students');
    for (const repair of repairs) {
      event('repair-created-' + repair.id, 'แจ้งซ่อม #' + repair.id, repair.createdAt, '/maintenance');
      event('repair-resolved-' + repair.id, 'บันทึกซ่อมเสร็จ #' + repair.id, repair.resolvedAt, '/maintenance');
    }
    const perRoom = [...rows.values()].map(r => ({ ...r, billPaid: r.billPaid / 100,
      depositPaid: r.depositPaid / 100, outstanding: r.outstanding / 100, received: (r.billPaid + r.depositPaid) / 100 }))
      .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, 'th', { numeric: true }));
    const total = perRoom.reduce((sum, r) => ({ billPaid: sum.billPaid + satang(r.billPaid),
      depositPaid: sum.depositPaid + satang(r.depositPaid), outstanding: sum.outstanding + satang(r.outstanding) }),
      { billPaid: 0, depositPaid: 0, outstanding: 0 });
    const current = months.get(monthKey(now));
    const monthlyReceipts = [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-6)
      .map(m => ({ ...m, billPaid: m.billPaid / 100, depositPaid: m.depositPaid / 100 }));
    return {
      totals: { billPaid: total.billPaid / 100, depositPaid: total.depositPaid / 100,
        received: (total.billPaid + total.depositPaid) / 100, outstanding: total.outstanding / 100,
        receivedThisMonth: ((current?.billPaid || 0) + (current?.depositPaid || 0)) / 100, undatedReceived: undatedReceived / 100 },
      perRoom, monthlyReceipts, housingPayments,
      urgent: { overdueBills: overdueCount, waitingVisitors,
        paidAwaitingApplication: housingPayments.filter(p => p.state === 'AWAITING_APPLICATION').length,
        paidAwaitingAdminApproval: housingPayments.filter(p => p.state === 'AWAITING_ADMIN_APPROVAL').length,
        housingPaymentsNeedReview: housingPayments.filter(p => p.state === 'NEEDS_REVIEW').length },
      activity: activity.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 12),
    };
  }

  static async getPrometheusMetricsRaw(): Promise<string> {
    return promClient.register.metrics();
  }

  static async getObservabilityAnalytics(): Promise<ObservabilityAnalyticsResponse> {
    const system = this.getSystemAnalytics();

    try {
      const [http, login, faceVerification] = await Promise.all([
        this.queryPrometheusBreakdown('sum by (status_code) (dormitory_http_requests_total)', 'status_code'),
        this.queryPrometheusBreakdown('sum by (outcome) (dormitory_auth_login_attempts_total)', 'outcome'),
        this.queryPrometheusBreakdown('sum by (outcome) (dormitory_face_verification_attempts_total)', 'outcome'),
      ]);

      return {
        system,
        http: Object.keys(http).length === 0 ? null : {
          '2xx': this.sumStatusClass(http, 2),
          '3xx': this.sumStatusClass(http, 3),
          '4xx': this.sumStatusClass(http, 4),
          '5xx': this.sumStatusClass(http, 5),
        },
        security: Object.keys(login).length && Object.keys(faceVerification).length ? { login, faceVerification } : null,
        metricsAvailable: Boolean(Object.keys(http).length && Object.keys(login).length && Object.keys(faceVerification).length),
        metricsSource: 'prometheus',
        timestamp: new Date().toISOString(),
      };
    } catch {
      return {
        system,
        http: null,
        security: null,
        metricsAvailable: false,
        metricsSource: 'unavailable',
        timestamp: new Date().toISOString(),
      };
    }
  }

  private static async queryPrometheusBreakdown(query: string, label: string): Promise<MetricBreakdown> {
    const defaultUrl = `http://127.0.0.1:${process.env.PROMETHEUS_HOST_PORT || '9091'}`;
    const baseUrl = (process.env.PROMETHEUS_INTERNAL_URL || defaultUrl).replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/api/v1/query?query=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`Prometheus query failed with HTTP ${response.status}`);

    const payload = await response.json() as PrometheusQueryResponse;
    if (payload.status !== 'success' || !Array.isArray(payload.data?.result)) throw new Error('Prometheus query was unsuccessful');

    return (payload.data?.result ?? []).reduce<MetricBreakdown>((result, item) => {
      const key = item.metric?.[label];
      const value = Number(item.value?.[1]);
      if (key && Number.isFinite(value)) result[key] = value;
      return result;
    }, {});
  }

  private static sumStatusClass(breakdown: MetricBreakdown, statusClass: number): number {
    return Object.entries(breakdown).reduce((total, [statusCode, value]) => (
      statusCode.startsWith(String(statusClass)) ? total + value : total
    ), 0);
  }
}
