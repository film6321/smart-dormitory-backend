import { AppError } from '../../middlewares/error-handler';
import { prisma } from '../../database/db';

export const DEFAULT_SETTINGS = {
  academicYear: { value: '2026/2027', category: 'GENERAL' },
  currentTerm: { value: 'ภาคการศึกษาที่ 2', category: 'GENERAL' },
  maxOccupants: { value: '4', category: 'DORMITORY' },
  checkInTime: { value: '14:00', category: 'DORMITORY' },
  checkOutTime: { value: '12:00', category: 'DORMITORY' },
  emailNotifications: { value: 'true', category: 'NOTIFICATIONS' },
  smsNotifications: { value: 'true', category: 'NOTIFICATIONS' },
  pushNotifications: { value: 'true', category: 'NOTIFICATIONS' },
  twoFactorAuthentication: { value: 'true', category: 'SECURITY' },
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
  rows.forEach((row) => { result[row.key] = row.value; });
  return result;
};

export class SettingsService {
  static async get() {
    const rows = await prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
    return { settings: toSettingsObject(rows) };
  }

  static async update(payload: SettingsPayload, userId: number) {
    const entries = Object.entries(payload).filter(([key, value]) => key in DEFAULT_SETTINGS && typeof value === 'string');
    if (entries.length === 0) throw new AppError('No valid settings were provided', 400);

    for (const [key, value] of entries) {
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

    await prisma.$transaction(
      entries.map(([key, value]) => prisma.systemSetting.upsert({
        where: { key },
        create: { key, value, category: DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS].category, updatedById: userId },
        update: { value, updatedById: userId },
      })),
    );

    return this.get();
  }
}
