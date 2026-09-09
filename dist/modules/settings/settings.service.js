"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsService = exports.getSettingValue = exports.DEFAULT_SETTINGS = void 0;
const error_handler_1 = require("../../middlewares/error-handler");
const db_1 = require("../../database/db");
exports.DEFAULT_SETTINGS = {
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
};
const getSettingValue = async (key) => {
    const settingClient = db_1.prisma.systemSetting;
    if (!settingClient)
        return exports.DEFAULT_SETTINGS[key].value;
    try {
        const row = await settingClient.findUnique({ where: { key } });
        return row?.value ?? exports.DEFAULT_SETTINGS[key].value;
    }
    catch {
        return exports.DEFAULT_SETTINGS[key].value;
    }
};
exports.getSettingValue = getSettingValue;
const toSettingsObject = (rows) => {
    const result = Object.fromEntries(Object.entries(exports.DEFAULT_SETTINGS).map(([key, setting]) => [key, setting.value]));
    rows.forEach((row) => { result[row.key] = row.value; });
    return result;
};
class SettingsService {
    static async get() {
        const rows = await db_1.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
        return { settings: toSettingsObject(rows) };
    }
    static async update(payload, userId) {
        const entries = Object.entries(payload).filter(([key, value]) => key in exports.DEFAULT_SETTINGS && typeof value === 'string');
        if (entries.length === 0)
            throw new error_handler_1.AppError('No valid settings were provided', 400);
        for (const [key, value] of entries) {
            if (key === 'maxOccupants' || key === 'sessionTimeoutMinutes') {
                const numericValue = Number(value);
                if (!Number.isInteger(numericValue) || numericValue <= 0) {
                    throw new error_handler_1.AppError(`Invalid value for ${key}`, 400);
                }
            }
            if (['emailNotifications', 'smsNotifications', 'pushNotifications', 'twoFactorAuthentication'].includes(key) && value !== 'true' && value !== 'false') {
                throw new error_handler_1.AppError(`Invalid value for ${key}`, 400);
            }
        }
        await db_1.prisma.$transaction(entries.map(([key, value]) => db_1.prisma.systemSetting.upsert({
            where: { key },
            create: { key, value, category: exports.DEFAULT_SETTINGS[key].category, updatedById: userId },
            update: { value, updatedById: userId },
        })));
        return this.get();
    }
}
exports.SettingsService = SettingsService;
