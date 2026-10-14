import { plainToInstance } from 'class-transformer';
import { isIn } from 'class-validator';
import { prisma } from '../../database/db';
import { AppError } from '../../middlewares/error-handler';

export const PRIVACY_NOTICES = {
  HOUSING: {
    version: '2026-10-14.v1',
    title: 'ข้อมูลส่วนบุคคลสำหรับสมัครเข้าพัก',
    paragraphs: [
      'MEEDEE Dormitory เก็บชื่อ เลขบัตร วันเกิด ที่อยู่ ข้อมูลนักศึกษา ผู้ติดต่อฉุกเฉิน ภาพบัตร และหลักฐานชำระเงิน เพื่ออ่านข้อมูลจากเอกสาร ตรวจสอบใบสมัคร จัดทำสัญญา และจัดการการเข้าพัก',
      'ข้อมูลเข้าถึงได้เฉพาะผู้มีสิทธิ์ และส่งให้บริการอ่านเอกสารหรือตรวจสอบการชำระเงินเท่าที่จำเป็นต่อรายการของคุณ ไม่ใช้ความยินยอมนี้แทนการยินยอมบันทึกใบหน้า',
      'ข้อมูลใบสมัครและไฟล์ที่ผูกจะถูกล้างเมื่อผู้ดูแลลบผู้พักตามขั้นตอนของระบบ โดยบัญชี User ยังคงอยู่ หากต้องการตรวจสอบ แก้ไข หรือขอให้ลบข้อมูล กรุณาติดต่อผู้ดูแลหอพัก',
      'กรุณาแจ้งผู้ติดต่อฉุกเฉินก่อนให้ข้อมูลของเขา หากไม่ต้องการดำเนินการ คุณสามารถกลับหน้าหลักได้โดยยังไม่อัปโหลดเอกสาร',
    ],
    checkboxLabel: 'ฉันอ่านคำชี้แจงแล้ว และยินยอมให้ประมวลผลข้อมูลเพื่อสมัครเข้าพักตามที่ระบุ',
  },
  FACE_ENROLLMENT: {
    version: '2026-10-14.v1',
    title: 'ยินยอมใช้ข้อมูลใบหน้าสำหรับเข้า–ออกหอพัก',
    paragraphs: [
      'MEEDEE Dormitory เก็บภาพใบหน้าและข้อมูลลักษณะใบหน้าที่ใช้เปรียบเทียบตัวตน ซึ่งเป็นข้อมูลชีวภาพ เพื่อยืนยันตัวตนและบันทึกการเข้า–ออกหอพัก',
      'ภาพจะส่งให้บริการประมวลผลใบหน้าที่ระบบเชื่อมต่อ ผู้ดูแลที่มีสิทธิ์เข้าถึงข้อมูลเพื่อดูแลระบบและความปลอดภัย ไม่รวมการใช้เพื่อโฆษณาหรือวัตถุประสงค์อื่น',
      'ระบบจะไม่เปิดกล้องหรือให้ส่งภาพก่อนคุณยินยอม การไม่ยินยอมไม่ยกเลิกบัญชีหรือสัญญา กรุณาติดต่อผู้ดูแลเพื่อสอบถามวิธียืนยันตัวตนอื่น',
      'หากต้องการถอนความยินยอมหรือขอลบข้อมูลใบหน้า ให้ติดต่อผู้ดูแล การถอนจะกระทบการใช้ใบหน้ายืนยันตัวตน เมื่อผู้ดูแลดำเนินการย้ายออกหรือลบผู้พัก ระบบจะล้างข้อมูลใบหน้าตามขั้นตอน ไม่ได้ล้างอัตโนมัติเพียงเพราะถึงวันสิ้นสุดสัญญา',
    ],
    checkboxLabel: 'ฉันยินยอมโดยชัดแจ้งให้เก็บและใช้ภาพใบหน้าและข้อมูลชีวภาพตามวัตถุประสงค์ข้างต้น',
  },
} as const;
export type PrivacyPurpose = keyof typeof PRIVACY_NOTICES;
class ConsentDto { purpose!: PrivacyPurpose; version!: string; accepted!: boolean; }

export class PrivacyConsentService {
  static purpose(value: unknown): PrivacyPurpose {
    if (!isIn(value, Object.keys(PRIVACY_NOTICES))) throw new AppError('Invalid privacy purpose', 400);
    return value as PrivacyPurpose;
  }
  static path(purpose: PrivacyPurpose) {
    return `privacy-consent/${purpose}/${PRIVACY_NOTICES[purpose].version}`;
  }
  static async get(userId: number, purpose: PrivacyPurpose) {
    const evidence = await prisma.accessLog.findFirst({
      where: { userId, method: 'CONSENT', path: this.path(purpose) }, orderBy: { id: 'desc' },
    });
    return { purpose, ...PRIVACY_NOTICES[purpose], acceptedAt: evidence?.createdAt ?? null };
  }
  static async accept(userId: number, body: unknown) {
    const input = plainToInstance(ConsentDto, body);
    const purpose = this.purpose(input?.purpose);
    if (input.accepted !== true || input.version !== PRIVACY_NOTICES[purpose].version) {
      throw new AppError('กรุณาอ่านและยินยอมตามคำชี้แจงฉบับปัจจุบัน', 400);
    }
    // The account lock makes repeated clicks/tabs share one durable evidence row.
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const where = { userId, method: 'CONSENT', path: this.path(purpose) };
      if (!await tx.accessLog.findFirst({ where })) await tx.accessLog.create({ data: where });
    });
    return this.get(userId, purpose);
  }
  static async require(userId: number, purpose: PrivacyPurpose) {
    if (!(await this.get(userId, purpose)).acceptedAt) {
      throw new AppError(purpose === 'HOUSING'
        ? 'กรุณายืนยันการใช้ข้อมูลส่วนบุคคลก่อนสมัครเข้าพัก'
        : 'เจ้าของบัญชีต้องยินยอมใช้ข้อมูลใบหน้าก่อนบันทึกภาพ', 403);
    }
  }
}
