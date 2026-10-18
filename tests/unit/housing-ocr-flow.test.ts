import { prisma } from '../../src/database/db';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isFilledText, validateHousingApplication } from '../../src/modules/tenants/tenants.dto';
import { TenantsService } from '../../src/modules/tenants/tenants.service';
import { OcrService } from '../../src/modules/ocr/ocr.service';
import { AppError } from '../../src/middlewares/error-handler';
import fs from 'fs/promises';
import { HousingPaymentService } from '../../src/modules/tenants/housing-payment.service';
import { HousingDraftService } from '../../src/modules/tenants/housing-draft.service';
import { getContractDates } from '../../src/modules/settings/settings.service';

test('contract dates use Bangkok today and five calendar months with month-end clamping', () => {
  assert.deepEqual(getContractDates(new Date('2026-10-13T05:00:00Z')), { startDate: '2026-10-13', endDate: '2027-03-13' });
  assert.deepEqual(getContractDates(new Date('2026-09-30T17:30:00Z')), { startDate: '2026-10-01', endDate: '2027-03-01' });
  assert.deepEqual(getContractDates(new Date('2026-09-30T00:00:00Z')), { startDate: '2026-09-30', endDate: '2027-02-28' });
  assert.deepEqual(getContractDates(new Date('2027-09-30T00:00:00Z')), { startDate: '2027-09-30', endDate: '2028-02-29' });
});

test('Housing Application Validation & OCR Flow', async (t) => {
  t.mock.method(HousingDraftService, 'bindIdentity', async () => {});
  t.mock.method(HousingPaymentService, 'verifyDraftSlip', async (...args: Parameters<typeof HousingPaymentService.verifyDraftSlip>) => HousingPaymentService.verifySlip(...args));
  const originalUser = prisma.user.findUnique;
  const originalVerification = prisma.idCardVerification.findUnique;
  Reflect.set(prisma.user, 'findUnique', async () => ({ phone: '0812345678' }));
  Reflect.set(prisma.idCardVerification, 'findUnique', async (args: { where: { id: number } }) => ({ id: args.where.id, userId: 1, idDetected: true, imagePath: 'uploads/private/id-cards/2026/09/card.jpg' }));
  t.after(() => { Reflect.set(prisma.user, 'findUnique', originalUser); Reflect.set(prisma.idCardVerification, 'findUnique', originalVerification); });
  await t.test('slip verification accepts an existing account without phone but still checks document ownership', async () => {
    const previousUser = prisma.user.findUnique;
    const previousVerify = HousingPaymentService.verifySlip;
    Reflect.set(prisma.user, 'findUnique', async () => ({ phone: null }));
    let calls = 0;
    Reflect.set(HousingPaymentService, 'verifySlip', async () => {
      calls++; return { id: 99, slipPath: 'uploads/private/payment-slips/fixture.jpg', amount: 300 };
    });
    try {
      const file = { mimetype: 'image/jpeg', buffer: Buffer.from('fixture') };
      const result = await TenantsService.verifyHousingPayment(file, 1, '101', 103);
      assert.equal(result.registeredPhone, ''); assert.equal(result.paymentVerification.id, 99);
      await assert.rejects(TenantsService.verifyHousingPayment(file, 2, '101', 103), /บัญชีนี้/u);
      assert.equal(calls, 1);
      Reflect.set(prisma.user, 'findUnique', async () => null);
      await assert.rejects(TenantsService.verifyHousingPayment(file, 1, '101', 103), /User not found/u);
      assert.equal(calls, 1);
    } finally {
      Reflect.set(prisma.user, 'findUnique', previousUser);
      Reflect.set(HousingPaymentService, 'verifySlip', previousVerify);
    }
  });
  await t.test('isFilledText rejects empty, whitespace, hyphens, and placeholder strings', () => {
    assert.equal(isFilledText(''), false);
    assert.equal(isFilledText('   '), false);
    assert.equal(isFilledText('-'), false);
    assert.equal(isFilledText('--'), false);
    assert.equal(isFilledText(' - '), false);
    assert.equal(isFilledText('—'), false);
    assert.equal(isFilledText('–'), false);
    assert.equal(isFilledText('***'), false);
    assert.equal(isFilledText('___'), false);
    assert.equal(isFilledText('N/A'), false);
    assert.equal(isFilledText('n/a'), false);
    assert.equal(isFilledText('null'), false);
    assert.equal(isFilledText('undefined'), false);
    assert.equal(isFilledText('none'), false);
    assert.equal(isFilledText(null), false);
    assert.equal(isFilledText(undefined), false);

    assert.equal(isFilledText('สมชาย ใจดี'), true);
    assert.equal(isFilledText('1234567890123'), true);
    assert.equal(isFilledText('20'), true);
  });

  await t.test('validateHousingApplication blocks submission if any required field is empty or contains "-"', () => {
    const validContract: Record<string, string> = {
      docLocation: 'หอพักสุขสบาย',
      docDate: '21',
      docMonth: 'กันยายน',
      docYear: '2569',
      landlordName: 'นายสมบัติ เจ้าของหอ',
      landlordAddress: '123/4 ถ.พหลโยธิน กรุงเทพฯ',
      landlordPhone: '0812345678',
      tenantName: 'นายทดสอบ นักศึกษา',
      tenantAge: '20',
      tenantCitizenId: '1234567890123',
      tenantAddress: '456/7 ถ.มิตรภาพ ขอนแก่น',
      tenantPhone: '0898765432',
      roomNumber: '201',
      building: 'A',
      floor: '2',
      startDate: '2026-09-01',
      endDate: '2027-08-31',
      monthlyRent: '4500',
      depositAmount: '9000',
      keycardDeposit: '500',
      payDueDate: '5',
      electricityRate: '8',
      waterRate: '18',
      advanceNoticeDays: '30',
    };

    const baseInput = {
      contractAccepted: true,
      personalInformation: { birthDate: '2000-01-15', citizenId: '1234567890123', address: 'QA Address',
        fullName: 'นายทดสอบ นักศึกษา',
        studentId: '65010001',
        course: 'วิทยาการคอมพิวเตอร์',
        yearLevel: '3',
        contactNumber: '0898765432',
        emailAddress: 'test@student.ac.th',
      },
      emergencyContact: {
        emergencyName: 'นางสมศรี มารดา',
        relationship: 'มารดา',
        emergencyNumber: '0811112222',
      },
      roomPreference: {
        preferredRoomType: 'ชั้น 2 ห้องเดี่ยว',
        roomNumber: '201',
        isRandomRoom: false,
      },
      ocrData: {
        verificationId: 101,
      },
      idCardImagePath: 'uploads/private/id-cards/card.jpg',
      paymentSlipPath: 'uploads/private/payment-slips/slip.jpg',
      paymentId: 1,
      contractData: { ...validContract },
      userId: 1,
    };

    // Case 1: Valid input passes
    assert.doesNotThrow(() => validateHousingApplication(baseInput));

    // Case 2: Missing or hyphen in personal information
    assert.throws(
      () => validateHousingApplication({
        ...baseInput,
        personalInformation: { ...baseInput.personalInformation, studentId: '-' },
      }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400 && err.message.includes('รหัสนักศึกษา')
    );

    // Case 3: Missing or hyphen in emergency contact
    assert.throws(
      () => validateHousingApplication({
        ...baseInput,
        emergencyContact: { ...baseInput.emergencyContact, emergencyNumber: ' - ' },
      }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400 && err.message.includes('เบอร์ผู้ติดต่อฉุกเฉิน')
    );

    // Case 4: Hyphen in one of contract fields (e.g. tenantCitizenId or tenantAddress)
    assert.throws(
      () => validateHousingApplication({
        ...baseInput,
        personalInformation: { ...baseInput.personalInformation, address: '-' },
      }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400 && err.message.includes('ที่อยู่')
    );

    // Case 5: Hyphen or invalid citizen id
    assert.throws(
      () => validateHousingApplication({
        ...baseInput,
        personalInformation: { ...baseInput.personalInformation, citizenId: '-' },
      }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400
    );

    // Case 6: Hyphen or invalid tenant age
    assert.throws(
      () => validateHousingApplication({
        ...baseInput,
        personalInformation: { ...baseInput.personalInformation, birthDate: '-' },
      }),
      (err: unknown) => err instanceof AppError && err.statusCode === 400
    );
  });

  await t.test('OCR Flow Requirement 1: Reject image if not an ID card (idDetected = false)', async () => {
    const originalVerify = OcrService.verifyIdCard;
    OcrService.verifyIdCard = async () => ({
      verificationId: 10,
      isThaiIdCard: false,
      reason: 'Image is not a Thai ID card',
      confidence: {
        idDetected: false,
        idPresent: false,
        idChecksumValid: false,
      },
    });

    try {
      const mockFile = {
        mimetype: 'image/jpeg',
        buffer: Buffer.from('fake-image-bytes'),
      };

      await assert.rejects(
        async () => {
          await TenantsService.uploadDocuments(mockFile, mockFile, 1, '101');
        },
        (err: unknown) => err instanceof AppError && err.statusCode === 422 && err.message.includes('ไม่ผ่านการตรวจว่าเป็นบัตรประชาชน')
      );
    } finally {
      OcrService.verifyIdCard = originalVerify;
    }
  });

  await t.test('OCR Flow Requirement 2: Allow partial ID card and return empty string "" for unreadable fields', async () => {
    const originalVerify = OcrService.verifyIdCard;
    const originalMkdir = fs.mkdir;
    const originalWriteFile = fs.writeFile;
    const originalPaymentVerify = HousingPaymentService.verifySlip;
    HousingPaymentService.verifySlip = async () => ({ id: 1, status: 'PAID', amount: 100,
      slipPath: 'uploads/private/payment-slips/verified.jpg' }) as unknown as Awaited<ReturnType<typeof HousingPaymentService.verifySlip>>;

    fs.mkdir = (async () => undefined) as typeof fs.mkdir;
    fs.writeFile = (async () => undefined) as typeof fs.writeFile;

    OcrService.verifyIdCard = async () => ({
      verificationId: 102,
      isThaiIdCard: false,
      imagePath: 'uploads/private/id-cards/2026/09/card.jpg',
      confidence: {
        idDetected: true,
        idPresent: true,
        idChecksumValid: false,
      },
      fullNameTh: 'นายสมชาย ใจดี',
      citizenId: undefined,
      birthDateTh: undefined,
      address: '---',
      age: undefined,
    });

    try {
      const mockFile = {
        mimetype: 'image/jpeg',
        buffer: Buffer.from('fake-image-bytes'),
      };

      const res = await TenantsService.uploadDocuments(mockFile, mockFile, 1, '101');
      assert.equal(res.ocrData.cardDetected, true);
      assert.equal(res.ocrData.isThaiIdCard, false);
      assert.equal(res.ocrData.fullNameTh, 'นายสมชาย ใจดี');
      assert.equal(res.ocrData.citizenId, '');
      assert.equal(res.ocrData.birthDateTh, '');
      assert.equal(res.ocrData.address, '');
    } finally {
      OcrService.verifyIdCard = originalVerify;
      fs.mkdir = originalMkdir;
      fs.writeFile = originalWriteFile;
      HousingPaymentService.verifySlip = originalPaymentVerify;
    }
  });

  await t.test('OCR Flow Requirement 3: Allow complete Thai ID card and return all parsed fields', async () => {
    const originalVerify = OcrService.verifyIdCard;
    const originalMkdir = fs.mkdir;
    const originalWriteFile = fs.writeFile;
    const originalPaymentVerify = HousingPaymentService.verifySlip;
    HousingPaymentService.verifySlip = async () => ({ id: 1, status: 'PAID', amount: 100,
      slipPath: 'uploads/private/payment-slips/verified.jpg' }) as unknown as Awaited<ReturnType<typeof HousingPaymentService.verifySlip>>;

    fs.mkdir = (async () => undefined) as typeof fs.mkdir;
    fs.writeFile = (async () => undefined) as typeof fs.writeFile;

    OcrService.verifyIdCard = async () => ({
      verificationId: 103,
      isThaiIdCard: true,
      imagePath: 'uploads/private/id-cards/2026/09/card.jpg',
      confidence: {
        idDetected: true,
        idPresent: true,
        idChecksumValid: true,
      },
      fullNameTh: 'นายสมชาย สมบูรณ์',
      citizenId: '1234567890123',
      birthDateTh: '1 ม.ค. 2545',
      address: '123 หมู่ 4 ต.ในเมือง อ.เมือง จ.ขอนแก่น',
      age: 24,
    });

    try {
      const mockFile = {
        mimetype: 'image/jpeg',
        buffer: Buffer.from('fake-image-bytes'),
      };

      const res = await TenantsService.uploadDocuments(mockFile, mockFile, 1, '101');
      assert.equal(res.ocrData.cardDetected, true);
      assert.equal(res.ocrData.isThaiIdCard, true);
      assert.equal(res.ocrData.fullNameTh, 'นายสมชาย สมบูรณ์');
      assert.equal(res.ocrData.citizenId, '1234567890123');
      assert.equal(res.ocrData.birthDateTh, '1 ม.ค. 2545');
      assert.equal(res.ocrData.address, '123 หมู่ 4 ต.ในเมือง อ.เมือง จ.ขอนแก่น');
      assert.equal(res.ocrData.age, 24);
    } finally {
      OcrService.verifyIdCard = originalVerify;
      fs.mkdir = originalMkdir;
      fs.writeFile = originalWriteFile;
      HousingPaymentService.verifySlip = originalPaymentVerify;
    }
  });
});
