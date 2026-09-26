"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateHousingApplication = exports.isFilledText = exports.requiredContractFields = void 0;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const error_handler_1 = require("../../middlewares/error-handler");
exports.requiredContractFields = {
    docLocation: 'สถานที่ทำสัญญา', docDate: 'วันที่ทำสัญญา', docMonth: 'เดือนที่ทำสัญญา', docYear: 'ปีที่ทำสัญญา',
    landlordName: 'ชื่อผู้ให้เช่า', landlordAddress: 'ที่อยู่ผู้ให้เช่า', landlordPhone: 'โทรศัพท์ผู้ให้เช่า',
    tenantName: 'ชื่อผู้เช่า', tenantAge: 'อายุผู้เช่า', tenantCitizenId: 'เลขบัตรประชาชน',
    tenantAddress: 'ที่อยู่ผู้เช่า', tenantPhone: 'โทรศัพท์ผู้เช่า',
    roomNumber: 'ห้องพัก', building: 'อาคาร', floor: 'ชั้น',
    startDate: 'วันเริ่มสัญญา', endDate: 'วันสิ้นสุดสัญญา', monthlyRent: 'ค่าเช่ารายเดือน',
    depositAmount: 'เงินประกัน', keycardDeposit: 'เงินประกันคีย์การ์ด', payDueDate: 'วันที่ครบกำหนดชำระ',
    electricityRate: 'อัตราค่าไฟ', waterRate: 'อัตราค่าน้ำ', advanceNoticeDays: 'ระยะเวลาแจ้งย้ายออก',
};
class ContractFieldsDto {
}
const isFilledText = (value) => {
    if (typeof value !== 'string')
        return false;
    const trimmed = value.trim();
    if (!trimmed)
        return false;
    if (/^[\s\-–—_*#]+$/u.test(trimmed))
        return false;
    if (/^(n\/a|null|undefined|none)$/i.test(trimmed))
        return false;
    return true;
};
exports.isFilledText = isFilledText;
const validateHousingApplication = (data) => {
    const missing = [];
    const personalFields = {
        fullName: 'ชื่อ-นามสกุล', studentId: 'รหัสนักศึกษา', course: 'หลักสูตร',
        yearLevel: 'ชั้นปี', contactNumber: 'เบอร์โทรศัพท์', emailAddress: 'อีเมล',
    };
    for (const [field, label] of Object.entries(personalFields)) {
        if (!(0, exports.isFilledText)(data.personalInformation?.[field]))
            missing.push(label);
    }
    for (const [field, label] of Object.entries({
        emergencyName: 'ชื่อผู้ติดต่อฉุกเฉิน', relationship: 'ความสัมพันธ์', emergencyNumber: 'เบอร์ผู้ติดต่อฉุกเฉิน',
    })) {
        if (!(0, exports.isFilledText)(data.emergencyContact?.[field]))
            missing.push(label);
    }
    if (!(0, exports.isFilledText)(data.roomPreference?.preferredRoomType))
        missing.push('ชั้นห้องพักที่ต้องการ');
    if (!data.roomPreference?.isRandomRoom && !(0, exports.isFilledText)(data.roomPreference?.roomNumber))
        missing.push('ห้องพักที่เลือก');
    const rawContract = data.contractData;
    const contract = (0, class_transformer_1.plainToInstance)(ContractFieldsDto, rawContract && typeof rawContract === 'object' && !Array.isArray(rawContract) ? rawContract : {});
    for (const [field, label] of Object.entries(exports.requiredContractFields)) {
        if (!(0, exports.isFilledText)(contract[field]))
            missing.push(label);
    }
    if (missing.length)
        throw new error_handler_1.AppError('กรุณากรอกข้อมูลให้ครบ: ' + missing.join(', '), 400);
    if (!(0, class_validator_1.isEmail)(data.personalInformation.emailAddress.trim()))
        throw new error_handler_1.AppError('กรุณากรอกอีเมลให้ถูกต้อง', 400);
    if (!(0, class_validator_1.matches)(String(contract.tenantCitizenId).trim(), /^\d{13}$/)) {
        throw new error_handler_1.AppError('กรุณากรอกเลขบัตรประชาชนให้ครบ 13 หลัก', 400);
    }
    if (!(0, class_validator_1.matches)(String(contract.tenantAge).trim(), /^\d{1,3}$/)
        || Number(contract.tenantAge) < 1 || Number(contract.tenantAge) > 120) {
        throw new error_handler_1.AppError('กรุณากรอกอายุผู้เช่าให้ถูกต้อง', 400);
    }
    if (!(0, class_validator_1.isInt)(data.userId) || Number(data.userId) <= 0)
        throw new error_handler_1.AppError('กรุณาเข้าสู่ระบบ', 401);
    if (!(0, class_validator_1.isInt)(data.ocrData?.verificationId) || Number(data.ocrData?.verificationId) <= 0) {
        throw new error_handler_1.AppError('กรุณาอัปโหลดและตรวจสอบบัตรประชาชนก่อนยื่นใบสมัคร', 400);
    }
    if (!(0, class_validator_1.isInt)(data.paymentId) || Number(data.paymentId) <= 0)
        throw new error_handler_1.AppError('กรุณาตรวจสอบสลิปให้ผ่านก่อนยื่นใบสมัคร', 400);
    if (!(0, exports.isFilledText)(data.roomPreference?.roomNumber))
        throw new error_handler_1.AppError('กรุณาเลือกห้องให้ชัดเจนก่อนชำระเงิน', 400);
    if (!(0, exports.isFilledText)(data.idCardImagePath) || !(0, exports.isFilledText)(data.paymentSlipPath)) {
        throw new error_handler_1.AppError('กรุณาอัปโหลดเอกสารให้ครบก่อนยื่นใบสมัคร', 400);
    }
    return Object.fromEntries(Object.entries(contract).map(([key, value]) => [
        key, typeof value === 'string' ? value.trim() : value,
    ]));
};
exports.validateHousingApplication = validateHousingApplication;
