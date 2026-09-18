const fs = require('fs');

// 1. Update ChartCard.tsx
const chartCardCode = `import React from 'react';
import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Bar, Legend } from 'recharts';
import { BarChart3 } from 'lucide-react';
import styles from './ChartCard.module.css';
import type { MonthlySeries } from '../../context/dashboard-context';

interface ChartCardProps {
  data: MonthlySeries[];
}

const formatCurrency = (value: number) => \`฿\${value.toLocaleString('th-TH')}\`;

export const ChartCard: React.FC<ChartCardProps> = ({ data }) => {
  return (
    <article className={styles.dashCard}>
      <div className={styles.cardHeader}>
        <div>
          <p className={styles.eyebrow}>Monthly Billing Trends</p>
          <h3 className={styles.cardTitle}>ยอดชำระและค้างชำระรายเดือน</h3>
        </div>
        <div className={styles.headerIcon}>
          <BarChart3 size={20} color="#6366f1" />
        </div>
      </div>

      <div className={styles.chartWrapper}>
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height={290}>
            <BarChart data={data} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 12, fontWeight: 500 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }} tickFormatter={(val) => \`฿\${val >= 1000 ? (val / 1000).toFixed(val % 1000 === 0 ? 0 : 1) + 'k' : val}\`} />
              <Tooltip
                formatter={(value) => [formatCurrency(Number(value ?? 0)), '']}
                contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
              />
              <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ paddingTop: '10px', fontSize: '12px', fontWeight: 600 }} />
              <Bar name="ชำระแล้วเสร็จ (Income)" dataKey="income" fill="#2563eb" radius={[6, 6, 0, 0]} maxBarSize={45} />
              <Bar name="ค้างชำระ (Pending/Overdue)" dataKey="expenses" fill="#f59e0b" radius={[6, 6, 0, 0]} maxBarSize={45} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className={styles.emptyState}>ไม่มีข้อมูลบิลสำหรับแสดงผลกราฟ</div>
        )}
      </div>
    </article>
  );
};

export default ChartCard;
`;
fs.writeFileSync('c:/Users/raphi/Documents/smart-dormitory-frontend/src/componants/addminpage/components/ChartCard/ChartCard.tsx', chartCardCode, 'utf8');

// 2. Update ChartCard.module.css
const chartCardCss = `.dashCard {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 18px;
  padding: 22px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
  min-height: 420px;
}

.cardHeader {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
  height: 52px;
}

.eyebrow {
  margin: 0 0 4px 0;
  font-size: 0.75rem;
  font-weight: 800;
  color: #6366f1;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.cardTitle {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 800;
  color: #0f172a;
}

.headerIcon {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chartWrapper {
  width: 100%;
  flex-grow: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.emptyState {
  min-height: 260px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 14px;
  font-weight: 600;
  font-size: 0.9rem;
  width: 100%;
}
`;
fs.writeFileSync('c:/Users/raphi/Documents/smart-dormitory-frontend/src/componants/addminpage/components/ChartCard/ChartCard.module.css', chartCardCss, 'utf8');

// 3. Update DashboardPage.tsx
const dashboardPageCode = `import React, { useMemo } from 'react';
import {
  AlertTriangle,
  Building2,
  ClipboardList,
  DoorOpen,
  Gauge,
  ReceiptText,
  Users,
  CheckCircle2,
  Clock,
  TrendingUp,
  CreditCard,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Wrench,
  Activity,
  Layers,
} from 'lucide-react';
import { useDashboard } from '../../context/useDashboard';
import ActivityFeed from '../../components/ActivityFeed/ActivityFeed';
import ChartCard from '../../components/ChartCard/ChartCard';
import StatCard from '../../components/StatCard/StatCard';
import styles from './DashboardPage.module.css';

export const DashboardPage: React.FC = () => {
  const { metrics, activities, financials, series, rooms, students, maintenance, users, bills, error, loading } = useDashboard();

  const businessHealth = useMemo(() => {
    const occupiedRooms = rooms.filter((room) => room.status === 'Occupied').length;
    const availableRooms = rooms.filter((room) => room.status === 'Available').length;
    const pendingMaintenance = maintenance.filter((request) => request.status === 'Pending').length;
    const resolvedMaintenance = maintenance.filter((request) => request.status === 'Completed').length;
    const onlineUsers = users.filter((user) => user.isOnline).length;
    const occupancyRate = rooms.length > 0 ? Math.round((occupiedRooms / rooms.length) * 100) : 0;

    const totalBillsCount = bills.length;
    const paidBillsCount = bills.filter((b) => b.status === 'PAID').length;
    const collectionRate = totalBillsCount > 0 ? Math.round((paidBillsCount / totalBillsCount) * 100) : 100;

    return {
      occupiedRooms,
      availableRooms,
      pendingMaintenance,
      resolvedMaintenance,
      onlineUsers,
      occupancyRate,
      collectionRate,
      activeStudents: students.filter((student) => student.status === 'Active').length,
    };
  }, [maintenance, rooms, students, users, bills]);

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.skeletonGrid}>
          <RefreshCw size={24} className="animate-spin" />
          <span>กำลังโหลดข้อมูลแดชบอร์ด...</span>
        </div>
      </div>
    );
  }

  const statIcons = {
    Users: Users,
    Building2: Building2,
    DoorOpen: DoorOpen,
    ClipboardList: ClipboardList,
    ReceiptText: ReceiptText,
  };

  return (
    <div className={styles.page}>
      {/* Hero Header */}
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Real-time Operations & Management</p>
          <h2>แดชบอร์ดภาพรวมการดำเนินงานหอพัก</h2>
          <p className={styles.heroText}>
            ติดตามสถานะผู้พักอาศัย การเข้าพัก การเงิน และงานแจ้งซ่อมบำรุงแบบเรียลไทม์
          </p>
        </div>
      </section>

      {error && (
        <div className={styles.errorBanner}>
          <AlertTriangle size={18} />
          <span>เกิดข้อผิดพลาดในการโหลดข้อมูล: {error}</span>
        </div>
      )}

      {/* Main 5 Stat Cards */}
      <section className={styles.statsGrid}>
        {metrics.map((metric) => {
          const Icon = statIcons[metric.icon as keyof typeof statIcons] ?? Users;
          return <StatCard key={metric.id} label={metric.label} value={metric.value} icon={Icon} />;
        })}
      </section>

      {/* Row 1: Business Health & Operational Status (50/50 Balanced Grid) */}
      <section className={styles.balancedGrid}>
        {/* Card 1: Business Health */}
        <article className={styles.dashCard}>
          <div className={styles.cardHeader}>
            <div>
              <p className={styles.eyebrow}>Business Health</p>
              <h3 className={styles.cardTitle}>อัตราและสถานะการเข้าพัก</h3>
            </div>
            <div className={styles.headerIcon}>
              <Gauge size={20} color="#6366f1" />
            </div>
          </div>

          {/* Occupancy Indicator Bar */}
          <div className={styles.indicatorBar}>
            <div style={{ width: \`\${Math.max(5, businessHealth.occupancyRate)}%\`, background: 'linear-gradient(90deg, #6366f1, #10b981)' }} />
          </div>

          {/* 6 Structured Data Rows */}
          <div className={styles.dataRows}>
            <div className={styles.dataRow}>
              <span className={styles.rowLabel}><Activity size={15} color="#6366f1" /> อัตราการเข้าพัก</span>
              <strong className={styles.rowValue} style={{ color: '#6366f1' }}>{businessHealth.occupancyRate}%</strong>
            </div>
            <div className={styles.dataRow}>
              <span className={styles.rowLabel}><DoorOpen size={15} color="#64748b" /> ห้องที่มีผู้พักอาศัย</span>
              <strong className={styles.rowValue}>{businessHealth.occupiedRooms} ห้อง</strong>
            </div>
            <div className={styles.dataRow}>
              <span className={styles.rowLabel}><DoorOpen size={15} color="#10b981" /> ห้องพักว่างพร้อมจอง</span>
              <strong className={styles.rowValue} style={{ color: '#10b981' }}>{businessHealth.availableRooms} ห้อง</strong>
            </div>
            <div className={styles.dataRow}>
              <span className={styles.rowLabel}><UserCheck size={15} color="#3b82f6" /> ผู้พักอาศัยสถานะ Active</span>
              <strong className={styles.rowValue}>{businessHealth.activeStudents} คน</strong>
            </div>
            <div className={styles.dataRow}>
              <span className={styles.rowLabel}><Wrench size={15} color="#f59e0b" /> งานแจ้งซ่อมรอดำเนินการ</span>
              <strong className={styles.rowValue} style={{ color: businessHealth.pendingMaintenance > 0 ? '#ef4444' : '#10b981' }}>
                {businessHealth.pendingMaintenance} รายการ
              </strong>
            </div>
            <div className={styles.dataRow}>
              <span className={styles.rowLabel}><Users size={15} color="#8b5cf6" /> ผู้ใช้งานออนไลน์ขณะนี้</span>
              <strong className={styles.rowValue}>{businessHealth.onlineUsers} คน</strong>
            </div>
          </div>
        </article>

        {/* Card 2: Operational Status */}
        <article className={styles.dashCard}>
          <div className={styles.cardHeader}>
            <div>
              <p className={styles.eyebrow}>Operational Status</p>
              <h3 className={styles.cardTitle}>สรุปความพร้อมการให้บริการ</h3>
            </div>
            <div className={styles.headerIcon}>
              <TrendingUp size={20} color="#10b981" />
            </div>
          </div>

          {/* Operational Readiness Indicator Bar */}
          <div className={styles.indicatorBar}>
            <div style={{ width: '100%', background: '#10b981' }} />
          </div>

          {/* 6 Structured Data Rows (Matching Card 1 Line-for-Line) */}
          <div className={styles.dataRows}>
            <div className={styles.dataRow}>
              <span className={styles.rowLabel}><ShieldCheck size={15} color="#10b981" /> ระบบตรวจการเข้า-ออก</span>
              <span className={styles.statusPillGreen}>พร้อมใช้งาน (Live)</span>
            </div>
            <div className={styles.dataRow}>
              <span className={styles.rowLabel}><Clock size={15} color="#3b82f6" /> การอัปเดตข้อมูล</span>
              <strong className={styles.rowValue}>WebSocket Real-time</strong>
            </div>
            <div className={styles.dataRow}>
              <span className={styles.rowLabel}><CreditCard size={15} color="#f59e0b" /> ยอดเรียกเก็บเดือนปัจจุบัน</span>
              <strong className={styles.rowValue}>{financials.totalRent}</strong>
            </div>
            <div className={styles.dataRow}>
              <span className={styles.rowLabel}><CheckCircle2 size={15} color="#10b981" /> ยอดชำระแล้วเสร็จ</span>
              <strong className={styles.rowValue} style={{ color: '#10b981' }}>{financials.netIncome}</strong>
            </div>
            <div className={styles.dataRow}>
              <span className={styles.rowLabel}><Wrench size={15} color="#10b981" /> ซ่อมบำรุงที่แก้ไขสำเร็จ</span>
              <strong className={styles.rowValue}>{businessHealth.resolvedMaintenance} รายการ</strong>
            </div>
            <div className={styles.dataRow}>
              <span className={styles.rowLabel}><Layers size={15} color="#6366f1" /> อัตราการจัดเก็บค่าเช่า</span>
              <strong className={styles.rowValue} style={{ color: '#10b981' }}>{businessHealth.collectionRate}%</strong>
            </div>
          </div>
        </article>
      </section>

      {/* Row 2: Monthly Trends & Financial Overview (50/50 Balanced Grid) */}
      <section className={styles.balancedGrid}>
        {/* Left: Monthly Trends ChartCard */}
        <ChartCard data={series} />

        {/* Right: Billing & Finance Overview Card */}
        <article className={styles.dashCard}>
          <div className={styles.cardHeader}>
            <div>
              <p className={styles.eyebrow}>Billing & Finance</p>
              <h3 className={styles.cardTitle}>สรุปการเงินและบิลชำระเงิน</h3>
            </div>
            <div className={styles.headerIcon}>
              <ReceiptText size={20} color="#6366f1" />
            </div>
          </div>

          {/* Financial Readiness Bar */}
          <div className={styles.indicatorBar}>
            <div style={{ width: \`\${businessHealth.collectionRate}%\`, background: 'linear-gradient(90deg, #2563eb, #10b981)' }} />
          </div>

          {/* 6 Structured Financial Rows */}
          <div className={styles.dataRows}>
            <div className={styles.dataRow}>
              <span className={styles.rowLabel}>ยอดเรียกเก็บทั้งหมด</span>
              <strong className={styles.rowValue}>{financials.totalRent}</strong>
            </div>
            <div className={styles.dataRow}>
              <span className={styles.rowLabel}>ค่าน้ำประปา / ค่าไฟฟ้า</span>
              <strong className={styles.rowValue}>{financials.waterAndElectricity}</strong>
            </div>
            <div className={styles.dataRow}>
              <span className={styles.rowLabel}>ยอดค้างชำระ / รอตรวจสลิป</span>
              <strong className={styles.rowValue} style={{ color: '#ef4444' }}>{financials.outstandingPayments}</strong>
            </div>
            <div className={styles.dataRow}>
              <span className={styles.rowLabel}>รายรับสุทธิที่ได้รับแล้ว</span>
              <strong className={styles.rowValue} style={{ color: '#10b981' }}>{financials.netIncome}</strong>
            </div>
            <div className={styles.dataRow}>
              <span className={styles.rowLabel}>อัตราการจัดเก็บสำเร็จ</span>
              <strong className={styles.rowValue} style={{ color: '#10b981' }}>{businessHealth.collectionRate}%</strong>
            </div>
            <div className={styles.dataRow}>
              <span className={styles.rowLabel}>รอบบิลประมวลผล</span>
              <strong className={styles.rowValue}>ประจำเดือนปัจจุบัน</strong>
            </div>
          </div>
        </article>
      </section>

      {/* Row 3: Activity Feed */}
      <section>
        <ActivityFeed items={activities} />
      </section>
    </div>
  );
};

export default DashboardPage;
`;
fs.writeFileSync('c:/Users/raphi/Documents/smart-dormitory-frontend/src/componants/addminpage/pages/Dashboard/DashboardPage.tsx', dashboardPageCode, 'utf8');

// 4. Update DashboardPage.module.css
const dashboardPageCss = `.page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.hero {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 18px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.04);
  padding: 24px;
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: flex-start;
  background:
    radial-gradient(circle at top left, rgba(37, 99, 235, 0.12), transparent 34%),
    linear-gradient(135deg, #ffffff 0%, #f8fafc 48%, #eef6ff 100%);
}

.eyebrow {
  margin: 0 0 4px 0;
  color: #6366f1;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hero h2 {
  margin: 0;
  color: #0f172a;
  font-size: clamp(1.45rem, 2vw, 2.15rem);
  font-weight: 800;
}

.heroText {
  margin: 8px 0 0;
  max-width: 660px;
  color: #475569;
  line-height: 1.65;
  font-size: 0.92rem;
}

.errorBanner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 14px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
  font-weight: 700;
}

/* Symmetrical 5-column Stat Grid */
.statsGrid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 16px;
  align-items: stretch;
}

/* Symmetrical 50/50 Balanced Grid */
.balancedGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  align-items: stretch;
}

/* Uniform Card Structure across ALL cards */
.dashCard {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 18px;
  padding: 22px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
  min-height: 420px;
}

.cardHeader {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
  height: 52px;
}

.cardTitle {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 800;
  color: #0f172a;
}

.headerIcon {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
}

.indicatorBar {
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: #f1f5f9;
  margin-bottom: 16px;
  width: 100%;
}

.indicatorBar div {
  height: 100%;
  border-radius: inherit;
  transition: width 0.5s ease-out;
}

/* Uniform Data Rows (Row-by-Row Alignment) */
.dataRows {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  flex-grow: 1;
}

.dataRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  border-bottom: 1px solid #f1f5f9;
}

.dataRow:last-child {
  border-bottom: none;
}

.rowLabel {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #64748b;
  font-size: 0.88rem;
  font-weight: 500;
}

.rowValue {
  color: #0f172a;
  font-size: 0.92rem;
  font-weight: 700;
}

.statusPillGreen {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: #ecfdf5;
  color: #059669;
  font-size: 0.78rem;
  font-weight: 700;
  border: 1px solid #a7f3d0;
}

.skeletonGrid {
  min-height: 250px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: #f8fafc;
  border: 1px dashed var(--border);
  border-radius: 18px;
  color: #64748b;
  font-weight: 600;
}

@media (max-width: 1200px) {
  .statsGrid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 992px) {
  .statsGrid {
    grid-template-columns: repeat(2, 1fr);
  }
  .balancedGrid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 576px) {
  .statsGrid {
    grid-template-columns: 1fr;
  }
}
`;
fs.writeFileSync('c:/Users/raphi/Documents/smart-dormitory-frontend/src/componants/addminpage/pages/Dashboard/DashboardPage.module.css', dashboardPageCss, 'utf8');

console.log('Successfully updated Dashboard layout with 100% pixel-perfect symmetry');
