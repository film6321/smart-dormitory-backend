import os from 'os';
import promClient from 'prom-client';
import { prisma, type DbClient } from '../../database/db';

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
  timestamp: string;
}

export class AnalyticsService {
  static async getDashboardAnalytics(db: DbClient = prisma): Promise<DashboardAnalyticsResponse> {
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
      timestamp: new Date().toISOString(),
    };
  }

  static async getPrometheusMetricsRaw(): Promise<string> {
    return promClient.register.metrics();
  }
}
