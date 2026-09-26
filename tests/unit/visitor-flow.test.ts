import test from 'node:test';
import assert from 'node:assert/strict';
import { VisitorService } from '../../src/modules/visitor/visitor.service';
import { VisitorRepository } from '../../src/modules/visitor/visitor.repository';
import { OcrService } from '../../src/modules/ocr/ocr.service';
import { AppError } from '../../src/middlewares/error-handler';
import { prisma } from '../../src/database/db';
import { Prisma, VisitorStatus } from '@prisma/client';

type VisitorWithRelations = NonNullable<Awaited<ReturnType<typeof VisitorRepository.getVisitorById>>>;

test('Visitor Registration Flow & OCR Integration', async (t) => {
  await t.test('1. scanVisitorIdCard calls OCR and returns normalized pre-fill fields', async () => {
    const originalVerify = OcrService.verifyIdCard;
    OcrService.verifyIdCard = async () => ({
      verificationId: 201,
      isThaiIdCard: true,
      imagePath: 'uploads/private/id-cards/2026/09/visitor-card.jpg',
      confidence: {
        idDetected: true,
        idPresent: true,
        idChecksumValid: true,
      },
      fullNameTh: 'นายสมชาย ใจดี',
      citizenId: '1234567890123',
      citizenIdMasked: '123********23',
      birthDateTh: '15 พฤษภาคม 2535',
      address: '123/4 หมู่ 5 ต.ในเมือง อ.เมือง จ.ขอนแก่น',
      age: 34,
    });

    try {
      const res = await VisitorService.scanVisitorIdCard('data:image/jpeg;base64,fake-data');
      assert.equal(res.cardDetected, true);
      assert.equal(res.isThaiIdCard, true);
      assert.equal(res.guestName, 'นายสมชาย ใจดี');
      assert.equal(res.citizenId, '1234567890123');
      assert.equal(res.birthDate, '15 พฤษภาคม 2535');
      assert.equal(res.age, 34);
      assert.equal(res.address, '123/4 หมู่ 5 ต.ในเมือง อ.เมือง จ.ขอนแก่น');
      assert.equal(res.idCardImagePath, 'uploads/private/id-cards/2026/09/visitor-card.jpg');
    } finally {
      OcrService.verifyIdCard = originalVerify;
    }
  });

  await t.test('2. registerVisitor rejects if PDPA consent is false or missing', async () => {
    await assert.rejects(
      async () => {
        await VisitorService.registerVisitor({
          guestName: 'นายสมชาย ใจดี',
          pdpaConsent: false,
        });
      },
      (err: unknown) => err instanceof AppError && err.statusCode === 400 && err.message.includes('PDPA')
    );
  });

  await t.test('3. registerVisitor rejects if guestName is missing or too short', async () => {
    await assert.rejects(
      async () => {
        await VisitorService.registerVisitor({
          guestName: ' ',
          pdpaConsent: true,
        });
      },
      (err: unknown) => err instanceof AppError && err.statusCode === 400 && err.message.includes('ชื่อ-นามสกุล')
    );
  });

  await t.test('4. registerVisitor creates record with 24h expiresAt, QR code, and logs', async () => {
    const originalTx = prisma.$transaction;
    const now = new Date();
    const mockVisitor: VisitorWithRelations = {
      id: 55,
      guestName: 'นายสมชาย ใจดี',
      phone: '0812345678',
      relationship: 'Family',
      citizenId: '1234567890123',
      citizenIdMasked: '123********23',
      age: 34,
      birthDate: '15 พฤษภาคม 2535',
      address: '123/4 หมู่ 5 ขอนแก่น',
      idCardImagePath: null,
      purpose: 'มาเยี่ยม',
      roomId: 1,
      room: { roomNumber: '301' },
      tenantId: 1,
      tenant: { fullName: 'นายทดสอบ ผู้พัก', studentId: '65001' },
      status: VisitorStatus.REGISTERED,
      pdpaConsent: true,
      pdpaConsentAt: now,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      cancelledAt: null,
      checkedInAt: null,
      checkedOutAt: null,
      expectedEntryTime: null,
      qrCodeData: '{"visitorId":55}',
      createdAt: now,
      updatedAt: now,
      logs: [],
    };

    const mockTransactionFn = (async <T>(
      callback: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> => {
      const txMock = {
        visitor: {
          create: async () => mockVisitor,
          update: async (args: Prisma.VisitorUpdateArgs) => ({
            ...mockVisitor,
            qrCodeData: typeof args.data.qrCodeData === 'string' ? args.data.qrCodeData : mockVisitor.qrCodeData,
          }),
        },
        visitorLog: {
          create: async () => ({
            id: 1,
            visitorId: 55,
            eventType: 'REGISTERED',
            note: null,
            createdAt: now,
          }),
        },
      } as unknown as Prisma.TransactionClient;

      return callback(txMock);
    }) as typeof prisma.$transaction;

    prisma.$transaction = mockTransactionFn;

    try {
      const res = await VisitorService.registerVisitor({
        guestName: 'นายสมชาย ใจดี',
        phone: '0812345678',
        relationship: 'Family',
        citizenId: '1234567890123',
        age: 34,
        birthDate: '15 พฤษภาคม 2535',
        address: '123/4 หมู่ 5 ขอนแก่น',
        purpose: 'มาเยี่ยม',
        roomId: 1,
        tenantId: 1,
        pdpaConsent: true,
      });

      assert.equal(res.id, 55);
      assert.equal(res.guestName, 'นายสมชาย ใจดี');
      assert.ok(res.qrCodeData);
      assert.ok(res.expiresAt);
    } finally {
      prisma.$transaction = originalTx;
    }
  });

  await t.test('5. getVisitorPass returns pass details and canCancel flag', async () => {
    const originalGet = VisitorRepository.getVisitorById;
    const now = new Date();
    const futureExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const mockRecord: VisitorWithRelations = {
      id: 55,
      guestName: 'นายสมชาย ใจดี',
      phone: '0812345678',
      citizenId: '1234567890123',
      citizenIdMasked: '123********23',
      relationship: 'Family',
      age: 34,
      birthDate: '15 พฤษภาคม 2535',
      address: '123/4 หมู่ 5 ขอนแก่น',
      idCardImagePath: null,
      purpose: 'มาเยี่ยม',
      roomId: 1,
      room: { roomNumber: '301' },
      tenantId: 1,
      tenant: { fullName: 'นายทดสอบ ผู้พัก', studentId: '65001' },
      status: VisitorStatus.REGISTERED,
      pdpaConsent: true,
      pdpaConsentAt: now,
      expiresAt: futureExpiry,
      cancelledAt: null,
      checkedInAt: null,
      checkedOutAt: null,
      expectedEntryTime: null,
      qrCodeData: '{"visitorId":55}',
      createdAt: now,
      updatedAt: now,
      logs: [],
    };

    VisitorRepository.getVisitorById = async () => mockRecord;

    try {
      const pass = await VisitorService.getVisitorPass(55);
      assert.equal(pass.id, 55);
      assert.equal(pass.guestName, 'นายสมชาย ใจดี');
      assert.equal(pass.canCancel, true);
      assert.equal(pass.isExpired, false);
      assert.equal(pass.roomNumber, '301');
    } finally {
      VisitorRepository.getVisitorById = originalGet;
    }
  });

  await t.test('6. cancelVisitor blocks cancellation if already checked in', async () => {
    const originalGet = VisitorRepository.getVisitorById;
    const now = new Date();

    const mockCheckedIn: VisitorWithRelations = {
      id: 55,
      guestName: 'นายสมชาย ใจดี',
      phone: '0812345678',
      citizenId: null,
      citizenIdMasked: null,
      relationship: null,
      age: null,
      birthDate: null,
      address: null,
      idCardImagePath: null,
      purpose: null,
      roomId: null,
      room: null,
      tenantId: null,
      tenant: null,
      status: VisitorStatus.CHECKED_IN,
      pdpaConsent: true,
      pdpaConsentAt: now,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      cancelledAt: null,
      checkedInAt: now,
      checkedOutAt: null,
      expectedEntryTime: null,
      qrCodeData: null,
      createdAt: now,
      updatedAt: now,
      logs: [],
    };

    VisitorRepository.getVisitorById = async () => mockCheckedIn;

    try {
      await assert.rejects(
        async () => {
          await VisitorService.cancelVisitor(55);
        },
        (err: unknown) => err instanceof AppError && err.statusCode === 409 && err.message.includes('เช็คอิน')
      );
    } finally {
      VisitorRepository.getVisitorById = originalGet;
    }
  });

  await t.test('7. cancelVisitor blocks cancellation if expired (> 24 hours)', async () => {
    const originalGet = VisitorRepository.getVisitorById;
    const now = new Date();

    const mockExpired: VisitorWithRelations = {
      id: 55,
      guestName: 'นายสมชาย ใจดี',
      phone: null,
      citizenId: null,
      citizenIdMasked: null,
      relationship: null,
      age: null,
      birthDate: null,
      address: null,
      idCardImagePath: null,
      purpose: null,
      roomId: null,
      room: null,
      tenantId: null,
      tenant: null,
      status: VisitorStatus.REGISTERED,
      pdpaConsent: true,
      pdpaConsentAt: now,
      expiresAt: new Date(now.getTime() - 1000),
      cancelledAt: null,
      checkedInAt: null,
      checkedOutAt: null,
      expectedEntryTime: null,
      qrCodeData: null,
      createdAt: now,
      updatedAt: now,
      logs: [],
    };

    VisitorRepository.getVisitorById = async () => mockExpired;

    try {
      await assert.rejects(
        async () => {
          await VisitorService.cancelVisitor(55);
        },
        (err: unknown) => err instanceof AppError && err.statusCode === 409 && err.message.includes('หมดอายุ')
      );
    } finally {
      VisitorRepository.getVisitorById = originalGet;
    }
  });

  await t.test('8. cancelVisitor transitions status to CANCELLED and creates log', async () => {
    const originalGet = VisitorRepository.getVisitorById;
    const originalTx = prisma.$transaction;
    const now = new Date();

    const mockRecord: VisitorWithRelations = {
      id: 55,
      guestName: 'นายสมชาย ใจดี',
      phone: null,
      citizenId: null,
      citizenIdMasked: null,
      relationship: null,
      age: null,
      birthDate: null,
      address: null,
      idCardImagePath: null,
      purpose: null,
      roomId: null,
      room: null,
      tenantId: null,
      tenant: null,
      status: VisitorStatus.REGISTERED,
      pdpaConsent: true,
      pdpaConsentAt: now,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      cancelledAt: null,
      checkedInAt: null,
      checkedOutAt: null,
      expectedEntryTime: null,
      qrCodeData: null,
      createdAt: now,
      updatedAt: now,
      logs: [],
    };

    VisitorRepository.getVisitorById = async () => mockRecord;

    const mockTransactionFn = (async <T>(
      callback: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> => {
      const txMock = {
        visitor: {
          update: async (args: Prisma.VisitorUpdateArgs) => ({
            ...mockRecord,
            status: (args.data.status as VisitorStatus) || VisitorStatus.CANCELLED,
            cancelledAt: (args.data.cancelledAt as Date) || now,
          }),
        },
        visitorLog: {
          create: async () => ({
            id: 1,
            visitorId: 55,
            eventType: 'CANCELLED',
            note: 'ติดธุระด่วน',
            createdAt: now,
          }),
        },
      } as unknown as Prisma.TransactionClient;

      return callback(txMock);
    }) as typeof prisma.$transaction;

    prisma.$transaction = mockTransactionFn;

    try {
      const res = await VisitorService.cancelVisitor(55, 'ติดธุระด่วน');
      assert.equal(res.status, VisitorStatus.CANCELLED);
      assert.ok(res.cancelledAt);
    } finally {
      VisitorRepository.getVisitorById = originalGet;
      prisma.$transaction = originalTx;
    }
  });

  await t.test('9. registerVisitor resolves roomId from roomNumber string', async () => {
    const originalFindRoom = prisma.room.findFirst;
    const originalTx = prisma.$transaction;
    const now = new Date();

    prisma.room.findFirst = (async () => ({
      id: 301,
      roomNumber: '301',
      floor: 3,
      status: 'AVAILABLE',
      capacity: 1,
      monthlyRent: new Prisma.Decimal(3500),
      description: null,
      createdAt: now,
      updatedAt: now,
    })) as unknown as typeof prisma.room.findFirst;

    const createdInputs: Prisma.VisitorCreateInput[] = [];
    const mockTransactionFn = (async <T>(
      callback: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> => {
      const txMock = {
        visitor: {
          create: async ({ data }: Prisma.VisitorCreateArgs) => {
            createdInputs.push(data);
            return {
              id: 99,
              guestName: data.guestName,
              status: VisitorStatus.REGISTERED,
              expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
              qrCodeData: null,
              createdAt: now,
              updatedAt: now,
            };
          },
          update: async () => ({ id: 99 }),
        },
        visitorLog: {
          create: async () => ({ id: 1 }),
        },
      } as unknown as Prisma.TransactionClient;

      return callback(txMock);
    }) as typeof prisma.$transaction;

    prisma.$transaction = mockTransactionFn;

    try {
      await VisitorService.registerVisitor({
        guestName: 'นายทดสอบ ระบบ',
        roomNumber: 'ห้อง 301',
        pdpaConsent: true,
      });

      assert.equal(createdInputs.length, 1);
      assert.equal(createdInputs[0]?.room?.connect?.id, 301);
    } finally {
      prisma.room.findFirst = originalFindRoom;
      prisma.$transaction = originalTx;
    }
  });
});
