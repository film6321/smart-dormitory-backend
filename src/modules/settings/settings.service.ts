import { isISO8601 } from 'class-validator';
import type { Prisma } from '@prisma/client';
import { AppError } from '../../middlewares/error-handler';
import { prisma } from '../../database/db';

export const DEFAULT_SETTINGS = {
  contractDocLocation: { value: '', category: 'CONTRACT' },
  contractLandlordName: { value: '', category: 'CONTRACT' },
  contractLandlordAddress: { value: '', category: 'CONTRACT' },
  contractLandlordPhone: { value: '', category: 'CONTRACT' },
  contractBuilding: { value: '', category: 'CONTRACT' },
  contractStartDate: { value: '', category: 'CONTRACT' },
  contractEndDate: { value: '', category: 'CONTRACT' },
  contractKeycardDeposit: { value: '', category: 'CONTRACT' },
  contractPayDueDate: { value: '', category: 'CONTRACT' },
  contractElectricityRate: { value: '', category: 'CONTRACT' },
  contractWaterRate: { value: '', category: 'CONTRACT' },
  contractAdvanceNoticeDays: { value: '', category: 'CONTRACT' },
  academicYear: { value: '2026/2027', category: 'GENERAL' },
  currentTerm: { value: 'ภาคการศึกษาที่ 2', category: 'GENERAL' },
  maxOccupants: { value: '4', category: 'DORMITORY' },
  checkInTime: { value: '14:00', category: 'DORMITORY' },
  checkOutTime: { value: '12:00', category: 'DORMITORY' },
  emailNotifications: { value: 'true', category: 'NOTIFICATIONS' },
  smsNotifications: { value: 'true', category: 'NOTIFICATIONS' },
  twoFactorAuthentication: { value: 'false', category: 'SECURITY' },
  sessionTimeoutMinutes: { value: '30', category: 'SECURITY' },
  passwordPolicy: { value: 'เข้มงวด', category: 'SECURITY' },
} as const;

export type SettingsPayload = Partial<Record<keyof typeof DEFAULT_SETTINGS, string>>;

export const getSettingValue = async (key: keyof typeof DEFAULT_SETTINGS): Promise<string> => {
  const settingClient = (prisma as typeof prisma & {
    systemSetting?: { findUnique: (args: { where: { key: string } }) => Promise<{ value: string } | null> };
  }).systemSetting;
  if (!settingClient) return DEFAULT_SETTINGS[key].value;

  try {
    const row = await settingClient.findUnique({ where: { key } });
    return row?.value ?? DEFAULT_SETTINGS[key].value;
  } catch {
    return DEFAULT_SETTINGS[key].value;
  }
};

const toSettingsObject = (rows: Array<{ key: string; value: string }>) => {
  const result: Record<string, string> = Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).map(([key, setting]) => [key, setting.value]),
  );
  rows.forEach((row) => { if (Object.hasOwn(DEFAULT_SETTINGS, row.key)) result[row.key] = row.value; });
  result.twoFactorAuthentication = 'false'; // No second-factor implementation exists.
  return result;
};

export class SettingsService {
  static async get() {
    const rows = await prisma.systemSetting.findMany({ where: { category: { notIn: ['RETENTION_FILES', 'FACE_CLEANUP', 'VISITOR_IDEMPOTENCY', 'ACADEMIC_CATALOG', 'MAINTENANCE_UPLOAD'] } }, orderBy: { key: 'asc' } });
    return { settings: toSettingsObject(rows) };
  }

  static async update(payload: SettingsPayload, userId: number) {
    if (Object.keys(payload).some(key => !Object.hasOwn(DEFAULT_SETTINGS, key))) throw new AppError('Unsupported setting', 400);
    const entries = Object.entries(payload).filter(([key, value]) => Object.hasOwn(DEFAULT_SETTINGS, key) && typeof value === 'string');
    if (entries.length === 0) throw new AppError('No valid settings were provided', 400);

    for (const [key, value] of entries) {
      if (key.startsWith('contract')) {
        if (!value.trim() || value.length > 1000) throw new AppError('กรุณากรอกเงื่อนไขสัญญาให้ครบ', 400);
        if (['contractStartDate', 'contractEndDate'].includes(key) && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !isISO8601(value, { strict: true }))) throw new AppError('วันที่สัญญาต้องเป็น YYYY-MM-DD', 400);
        if (['contractKeycardDeposit', 'contractElectricityRate', 'contractWaterRate'].includes(key) && (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) > 1000000)) throw new AppError('อัตราบริการต้องเป็นจำนวนเงินที่ถูกต้อง', 400);
        if (['contractPayDueDate', 'contractAdvanceNoticeDays'].includes(key) && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > (key === 'contractPayDueDate' ? 28 : 365))) throw new AppError('กำหนดวันในสัญญาไม่ถูกต้อง', 400);
      }
      if (key === 'twoFactorAuthentication' && value !== 'false') throw new AppError('ระบบยังไม่รองรับการยืนยันตัวตนสองขั้นตอน', 400);
      if (['academicYear', 'currentTerm'].includes(key) && (!value.trim() || value.length > 100)) {
        throw new AppError(`กรุณาระบุ ${key === 'academicYear' ? 'ปีการศึกษา' : 'ภาคการศึกษา'} ไม่เกิน 100 ตัวอักษร`, 400);
      }
      if (['checkInTime', 'checkOutTime'].includes(key) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        throw new AppError('เวลาต้องอยู่ในรูปแบบ HH:mm', 400);
      }
      if (key === 'maxOccupants' || key === 'sessionTimeoutMinutes') {
        const numericValue = Number(value);
        if (!Number.isInteger(numericValue) || numericValue <= 0) {
          throw new AppError(`Invalid value for ${key}`, 400);
        }
      }
      if (['emailNotifications', 'smsNotifications', 'pushNotifications', 'twoFactorAuthentication'].includes(key) && value !== 'true' && value !== 'false') {
        throw new AppError(`Invalid value for ${key}`, 400);
      }
    }

    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS acquired FROM pg_advisory_xact_lock(756032)`;
      const current = toSettingsObject(await tx.systemSetting.findMany({ where: { category: 'CONTRACT' } }));
      const merged = { ...current, ...Object.fromEntries(entries) };
      if (merged.contractStartDate && merged.contractEndDate && merged.contractEndDate <= merged.contractStartDate) throw new AppError('วันสิ้นสุดสัญญาต้องอยู่หลังวันเริ่มสัญญา', 400);
      for (const [key, value] of entries) await tx.systemSetting.upsert({
        where: { key },
        create: { key, value, category: DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS].category, updatedById: userId },
        update: { value, updatedById: userId },
      });
    });

    return this.get();
  }
}

export const getContractDates = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const read = (type: string) => Number(parts.find(part => part.type === type)!.value);
  const year = read('year'), month = read('month') - 1, day = read('day');
  const lastDay = new Date(Date.UTC(year, month + 6, 0)).getUTCDate();
  return { startDate: new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10),
    endDate: new Date(Date.UTC(year, month + 5, Math.min(day, lastDay))).toISOString().slice(0, 10) };
};

export const getContractTerms = async (room?: { roomNumber: string; floor?: number | null; monthlyRent: unknown } | null, db: Pick<Prisma.TransactionClient, 'systemSetting'> = prisma, now = new Date()) => {
  const rows = await db.systemSetting?.findMany({ where: { category: 'CONTRACT' } }) ?? [];
  const values = { ...Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, item]) => [key, item.value])), ...Object.fromEntries(rows.map(row => [row.key, row.value])) };
  return { docLocation: values.contractDocLocation, landlordName: values.contractLandlordName,
    landlordAddress: values.contractLandlordAddress, landlordPhone: values.contractLandlordPhone,
    building: values.contractBuilding, ...getContractDates(now),
    keycardDeposit: values.contractKeycardDeposit, payDueDate: values.contractPayDueDate,
    electricityRate: values.contractElectricityRate, waterRate: values.contractWaterRate,
    advanceNoticeDays: values.contractAdvanceNoticeDays,
    docDate: now.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'Asia/Bangkok' }),
    docMonth: now.toLocaleDateString('th-TH', { month: 'long', timeZone: 'Asia/Bangkok' }),
    docYear: now.toLocaleDateString('th-TH-u-nu-latn', { year: 'numeric', timeZone: 'Asia/Bangkok' }).replace(/[^0-9]/g, ''),
    ...(room ? { roomNumber: room.roomNumber, floor: String(room.floor ?? ''), monthlyRent: String(room.monthlyRent), depositAmount: String(room.monthlyRent) } : {}),
  };
};
