import { calculateAge } from '../../shared/date-utils';
import { plainToInstance } from 'class-transformer';
import { isInt, matches, isString, isBoolean, isISO8601 } from 'class-validator';
import { AppError } from '../../middlewares/error-handler';
import type { SubmitApplicationInput, CreateTenantInput } from './tenants.service';
import { requestBody, text, optionalText, booleanValue } from '../../shared/input';

export function parseHousingApplication(value: unknown): SubmitApplicationInput {
  const body = requestBody(value);
  const personal = requestBody(body.personalInformation), emergency = requestBody(body.emergencyContact), room = requestBody(body.roomPreference);
  const ocr = body.ocrData === undefined ? undefined : requestBody(body.ocrData);
  return {
    personalInformation: { fullName: text(personal.fullName), studentId: text(personal.studentId), course: text(personal.course),
      facultyId: optionalText(personal.facultyId), yearLevel: text(personal.yearLevel), emailAddress: optionalText(personal.emailAddress),
      citizenId: optionalText(personal.citizenId), address: optionalText(personal.address), birthDate: optionalText(personal.birthDate) },
    emergencyContact: { emergencyName: text(emergency.emergencyName), relationship: text(emergency.relationship), emergencyNumber: text(emergency.emergencyNumber) },
    roomPreference: { preferredRoomType: text(room.preferredRoomType), roomNumber: optionalText(room.roomNumber), notes: optionalText(room.notes),
      isRandomRoom: room.isRandomRoom === undefined ? undefined : booleanValue(room.isRandomRoom) },
    ocrData: ocr ? { verificationId: ocr.verificationId === undefined ? undefined : Number(ocr.verificationId), citizenId: optionalText(ocr.citizenId),
      address: optionalText(ocr.address), birthDate: optionalText(ocr.birthDate), birthDateTh: optionalText(ocr.birthDateTh), fullNameTh: optionalText(ocr.fullNameTh) } : undefined,
    idCardImagePath: optionalText(body.idCardImagePath), paymentSlipPath: optionalText(body.paymentSlipPath),
    paymentId: body.paymentId === undefined ? undefined : Number(body.paymentId),
    contractAccepted: body.contractAccepted === undefined ? undefined : booleanValue(body.contractAccepted),
    excessAccepted: body.excessAccepted === undefined ? undefined : booleanValue(body.excessAccepted),
    contractData: body.contractData === undefined ? undefined : requestBody(body.contractData),
  };
}

export const requiredContractFields: Record<string, string> = {
  docLocation: 'สถานที่ทำสัญญา', docDate: 'วันที่ทำสัญญา', docMonth: 'เดือนที่ทำสัญญา', docYear: 'ปีที่ทำสัญญา',
  landlordName: 'ชื่อผู้ให้เช่า', landlordAddress: 'ที่อยู่ผู้ให้เช่า', landlordPhone: 'โทรศัพท์ผู้ให้เช่า',
  tenantName: 'ชื่อผู้เช่า', tenantAge: 'อายุผู้เช่า', tenantCitizenId: 'เลขบัตรประชาชน',
  tenantAddress: 'ที่อยู่ผู้เช่า',
  roomNumber: 'ห้องพัก', building: 'อาคาร', floor: 'ชั้น',
  startDate: 'วันเริ่มสัญญา', endDate: 'วันสิ้นสุดสัญญา', monthlyRent: 'ค่าเช่ารายเดือน',
  depositAmount: 'เงินประกัน', keycardDeposit: 'เงินประกันกุญแจ', payDueDate: 'วันที่ครบกำหนดชำระ',
  electricityRate: 'อัตราค่าไฟ', waterRate: 'อัตราค่าน้ำ', advanceNoticeDays: 'ระยะเวลาแจ้งย้ายออก',
};

class ContractFieldsDto {
  [key: string]: unknown;
}

export const isFilledText = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^[\s\-–—_*#]+$/u.test(trimmed)) return false;
  if (/^(n\/a|null|undefined|none)$/i.test(trimmed)) return false;
  return true;
};

export const normalizeThaiNameForComparison = (name: string): string => name
  .normalize('NFC')
  .trim()
  .replace(/^(?:เด็กชาย|เด็กหญิง|นางสาว|นาย|นาง|ด\.ช\.|ด\.ญ\.|น\.ส\.)\s*/u, '')
  .replace(/\s+/gu, '')
  .toLocaleLowerCase();

export const validateHousingApplication = (data: SubmitApplicationInput) => {
  const missing: string[] = [];
  const personalFields = {
    fullName: 'ชื่อ-นามสกุล', studentId: 'รหัสนักศึกษา', course: 'คณะ',
    yearLevel: 'ชั้นปี',
  } as const;
  for (const [field, label] of Object.entries(personalFields)) {
    if (!isFilledText(data.personalInformation?.[field as keyof typeof personalFields])) missing.push(label);
  }
  for (const [field, label] of Object.entries({
    emergencyName: 'ชื่อผู้ติดต่อฉุกเฉิน', relationship: 'ความสัมพันธ์', emergencyNumber: 'เบอร์ผู้ติดต่อฉุกเฉิน',
  })) {
    if (!isFilledText(data.emergencyContact?.[field as keyof SubmitApplicationInput['emergencyContact']])) missing.push(label);
  }
  if (!isFilledText(data.roomPreference?.preferredRoomType)) missing.push('ชั้นห้องพักที่ต้องการ');
  if (!data.roomPreference?.isRandomRoom && !isFilledText(data.roomPreference?.roomNumber)) missing.push('ห้องพักที่เลือก');
  const rawContract = data.contractData;
  const contract = plainToInstance(ContractFieldsDto,
    rawContract && typeof rawContract === 'object' && !Array.isArray(rawContract) ? rawContract : {});
  const personal = data.personalInformation;
  if (!personal || typeof personal !== 'object' || Array.isArray(personal)) throw new AppError('กรุณากรอกข้อมูลส่วนตัว', 400);
  if (data.contractAccepted !== true) throw new AppError('กรุณายอมรับสัญญาก่อนยื่นใบสมัคร', 400);
  {
    const age = calculateAge(personal.birthDate);
    if (!isString(personal.birthDate) || !/^\d{4}-\d{2}-\d{2}$/.test(personal.birthDate) || !isISO8601(personal.birthDate, { strict: true }) || age === undefined || age < 1 || age > 120) throw new AppError('กรุณาระบุวันเกิดที่ถูกต้อง', 400);
    contract.tenantAge = String(age);
  }
  {
    if (!isString(personal.citizenId) || !/^\d{13}$/.test(personal.citizenId)) throw new AppError('กรุณากรอกเลขบัตรประชาชนให้ครบ 13 หลัก', 400);
    contract.tenantCitizenId = personal.citizenId;
  }
  {
    if (!isFilledText(personal.address) || personal.address.length > 1000) throw new AppError('กรุณากรอกที่อยู่ให้ถูกต้อง', 400);
    contract.tenantAddress = personal.address.trim();
  }
  contract.tenantName = data.personalInformation?.fullName;
  for (const [field, label] of Object.entries(requiredContractFields)) {
    if (!isFilledText(contract[field])) missing.push(label);
  }
  if (missing.length) throw new AppError('กรุณากรอกข้อมูลให้ครบ: ' + missing.join(', '), 400);
  if (!matches(String(contract.tenantCitizenId).trim(), /^\d{13}$/)) {
    throw new AppError('กรุณากรอกเลขบัตรประชาชนให้ครบ 13 หลัก', 400);
  }
  if (!matches(String(contract.tenantAge).trim(), /^\d{1,3}$/)
    || Number(contract.tenantAge) < 1 || Number(contract.tenantAge) > 120) {
    throw new AppError('กรุณากรอกอายุผู้เช่าให้ถูกต้อง', 400);
  }
  if (!isInt(data.userId) || Number(data.userId) <= 0) throw new AppError('กรุณาเข้าสู่ระบบ', 401);
  if (!isInt(data.ocrData?.verificationId) || Number(data.ocrData?.verificationId) <= 0) {
    throw new AppError('กรุณาอัปโหลดและตรวจสอบบัตรประชาชนก่อนยื่นใบสมัคร', 400);
  }
  if (!isInt(data.paymentId) || Number(data.paymentId) <= 0) throw new AppError('กรุณาตรวจสอบสลิปให้ผ่านก่อนยื่นใบสมัคร', 400);
  if (!isFilledText(data.roomPreference?.roomNumber)) throw new AppError('กรุณาเลือกห้องให้ชัดเจนก่อนชำระเงิน', 400);
  if (!isFilledText(data.idCardImagePath) || !isFilledText(data.paymentSlipPath)) {
    throw new AppError('กรุณาอัปโหลดเอกสารให้ครบก่อนยื่นใบสมัคร', 400);
  }
  return Object.fromEntries(Object.entries(contract).map(([key, value]) => [
    key, typeof value === 'string' ? value.trim() : value,
  ])) as Record<string, string>;
};

class UpdateTenantDto {
  userId?: number | null;
  roomId?: number | null;
  fullName?: string;
  phone?: string;
  emergencyContact?: string;
  status?: string;
  checkInDate?: string;
  checkOutDate?: string;
  isActive?: boolean;
}

export function validateTenantUpdate(body: unknown): Partial<CreateTenantInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('Invalid tenant update', 400);
  const input = plainToInstance(UpdateTenantDto, body);
  const allowed = ['userId', 'roomId', 'fullName', 'phone', 'emergencyContact', 'status', 'checkInDate', 'checkOutDate', 'isActive'];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new AppError('Unsupported tenant field', 400);
  for (const field of ['userId', 'roomId'] as const) if (input[field] !== undefined && input[field] !== null && (!isInt(input[field]) || input[field]! <= 0)) throw new AppError('Invalid ' + field, 400);
  for (const field of ['fullName', 'phone', 'emergencyContact'] as const) if (input[field] !== undefined && (!isString(input[field]) || input[field]!.length > 255)) throw new AppError('Invalid ' + field, 400);
  if (input.status !== undefined && !['PENDING', 'APPROVED', 'ACTIVE', 'REJECTED', 'INACTIVE'].includes(input.status)) throw new AppError('Invalid tenant status', 400);
  if (input.isActive !== undefined && !isBoolean(input.isActive)) throw new AppError('Invalid isActive', 400);
  for (const field of ['checkInDate', 'checkOutDate'] as const) if (input[field] !== undefined && !isISO8601(input[field], { strict: true })) throw new AppError('Invalid ' + field, 400);
  return input;
}
