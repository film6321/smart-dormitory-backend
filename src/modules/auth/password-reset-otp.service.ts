import { createHmac, randomBytes, randomInt, timingSafeEqual, createHash } from 'node:crypto';
import { AppError } from '../../middlewares/error-handler';
import { getJwtSecret } from '../../shared/env';
import { AuthRepository } from './auth.repository';
import { normalizeThaiMobilePhone } from './phone-utils';

const INVALID_OTP_MESSAGE = 'รหัส OTP ไม่ถูกต้อง หมดอายุ หรือไม่สามารถใช้ได้';

interface MockSmsReceipt {
  provider: 'MOCK_SMS';
  maskedPhone: string;
  otp: string;
}

class MockSmsService {
  static send(phone: string, otp: string): MockSmsReceipt {
    return { provider: 'MOCK_SMS', maskedPhone: `••••${phone.slice(-4)}`, otp };
  }
}

const otpDigest = (userId: number, phone: string, otp: string): string =>
  createHmac('sha256', getJwtSecret()).update(`${userId}:${phone}:${otp}`).digest('hex');

const isEqualHex = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const assertMockModeEnabled = (): void => {
  const mode = process.env.PASSWORD_RESET_SMS_MODE?.trim().toLowerCase();
  const runtime = process.env.NODE_ENV?.trim().toLowerCase();
  if (mode !== 'mock' || runtime === 'production' || runtime === 'staging') {
    throw new AppError('ระบบส่ง OTP ยังไม่พร้อมให้บริการ', 503);
  }
};

export class PasswordResetOtpService {
  static async requestCode(rawPhone: string): Promise<MockSmsReceipt> {
    assertMockModeEnabled();
    const phone = normalizeThaiMobilePhone(rawPhone);
    if (!phone) throw new AppError('กรุณากรอกเบอร์โทรศัพท์มือถือไทยให้ถูกต้อง', 400);

    const userId = await AuthRepository.findUniqueUserIdByPhone(phone);
    if (userId === null) throw new AppError('ไม่พบเบอร์โทรศัพท์ที่ผูกกับบัญชีเดียวในระบบ', 400);

    const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await AuthRepository.setPasswordResetOtp(userId, otpDigest(userId, phone, otp), new Date(Date.now() + 5 * 60_000));
    return MockSmsService.send(phone, otp);
  }

  static async verifyCode(rawPhone: string, otp: string): Promise<{ resetToken: string }> {
    assertMockModeEnabled();
    const phone = normalizeThaiMobilePhone(rawPhone);
    if (!phone || !/^\d{6}$/.test(otp)) throw new AppError(INVALID_OTP_MESSAGE, 400);

    const userId = await AuthRepository.findUniqueUserIdByPhone(phone);
    if (userId === null) throw new AppError(INVALID_OTP_MESSAGE, 400);

    const now = new Date();
    const activeOtp = await AuthRepository.findActivePasswordResetOtp(userId, now);
    if (!activeOtp?.passwordResetOtpHash) throw new AppError(INVALID_OTP_MESSAGE, 400);

    const providedDigest = otpDigest(userId, phone, otp);
    if (!isEqualHex(activeOtp.passwordResetOtpHash, providedDigest)) {
      await AuthRepository.incrementPasswordResetOtpAttempts(userId, now);
      throw new AppError(INVALID_OTP_MESSAGE, 400);
    }

    const resetToken = randomBytes(32).toString('hex');
    const grant = await AuthRepository.issuePasswordResetGrant(
      userId,
      activeOtp.passwordResetOtpHash,
      createHash('sha256').update(resetToken).digest('hex'),
      now,
      new Date(now.getTime() + 10 * 60_000),
    );
    if (grant.count !== 1) throw new AppError(INVALID_OTP_MESSAGE, 400);
    return { resetToken };
  }
}
