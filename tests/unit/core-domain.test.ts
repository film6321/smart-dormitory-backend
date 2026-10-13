import assert from 'node:assert/strict';
import { describe, it, TestContext } from 'node:test';
import { UsersService } from '../../src/modules/users/users.service';
import { TenantsService } from '../../src/modules/tenants/tenants.service';
import { RoomsService } from '../../src/modules/rooms/rooms.service';
import * as settings from '../../src/modules/settings/settings.service';
import { prisma, DbClient } from '../../src/database/db';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Tenant, Room, Prisma, Role } from '@prisma/client';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/smart_dormitory?schema=public';

describe('core domain services', () => {
  it('rejects unsafe room prices and blocks changes to committed or selected rooms', async (t) => {
    let tenants = 0, drafts = 0, payments = 0, writes = 0;
    const tx = {
      $queryRaw: async () => [],
      room: { findUnique: async () => ({ id: 1, monthlyRent: 1000 }),
        update: async ({ data }: { data: Record<string, unknown> }) => { writes++; return data; } },
      tenant: { count: async () => tenants },
      housingApplicationDraft: { count: async () => drafts },
      payment: { count: async () => payments },
    };
    const previous = prisma.$transaction;
    Reflect.set(prisma, '$transaction', async (fn: (client: unknown) => Promise<unknown>) => fn(tx));
    t.after(() => Reflect.set(prisma, '$transaction', previous));
    for (const price of [0, -1, NaN, Infinity, '', 'abc', 1.001]) {
      await assert.rejects(RoomsService.updateRoom(1, { monthlyRent: price }), /ค่าเช่า/);
    }
    tenants = 1;
    await assert.rejects(RoomsService.updateRoom(1, { monthlyRent: 2000 }), /ยังเปลี่ยนราคาไม่ได้/);
    tenants = 0; drafts = 1;
    await assert.rejects(RoomsService.updateRoom(1, { monthlyRent: 2000 }), /ยังเปลี่ยนราคาไม่ได้/);
    drafts = 0; payments = 1;
    await assert.rejects(RoomsService.updateRoom(1, { monthlyRent: 2000 }), /ยังเปลี่ยนราคาไม่ได้/);
    assert.equal(writes, 0);
    payments = 0;
    await RoomsService.updateRoom(1, { monthlyRent: 2000.25 });
    assert.equal(writes, 1);
  });
  it('creates a user with a hashed password and returns the public profile', async () => {
    const fakePrisma = {
      user: {
        findUnique: async () => null,
        create: async ({ data }: Prisma.UserCreateArgs) => ({
          id: 101,
          email: data.email,
          role: data.role || Role.STUDENT,
          username: data.username || null,
          password: data.password,
          version: 1,
          lastLogin: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
    } as unknown as DbClient;

    const user = await UsersService.createUser(
      {
        email: 'student@example.com',
        password: 'Password123',
      },
      fakePrisma
    );

    assert.ok(user);
    assert.equal(user.email, 'student@example.com');
    assert.equal(user.role, 'STUDENT');
    assert.equal(user.id, 101);
  });

  it('creates a tenant linked to a user and room in a transaction', async (t) => {
    const f = roomAssignmentFixture(t, { sameRoom: true, creating: true });
    const tenant = await TenantsService.createTenant({
      userId: 11, roomId: 22, fullName: 'Jane Doe', phone: '+66811234567', status: 'APPROVED',
    }, f.db);
    assert.equal(tenant.id, 55);
    assert.equal(tenant.userId, 11);
    assert.equal(tenant.roomId, 22);
    assert.equal(tenant.status, 'APPROVED');
    assert.equal(f.transaction.mock.callCount(), 1);
  });

  it('creates a room with a normalized room number', async () => {
    const fakePrisma = {
      room: {
        findUnique: async () => null,
        create: async ({ data }: Prisma.RoomCreateArgs) => ({
          id: 77,
          roomNumber: data.roomNumber,
          floor: data.floor ?? null,
          status: data.status ?? 'AVAILABLE',
          capacity: data.capacity ?? 4,
          monthlyRent: new Prisma.Decimal(data.monthlyRent as number),
          description: data.description ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
    } as unknown as DbClient;

    const room = await RoomsService.createRoom(
      {
        roomNumber: ' 101 ',
        monthlyRent: 4500,
        capacity: 2,
      },
      fakePrisma
    );

    assert.equal(room.roomNumber, '101');
    assert.equal(Number(room.monthlyRent), 4500);
    assert.equal(room.capacity, 2);

    const defaultRoom = await RoomsService.createRoom(
      { roomNumber: ' 102 ', monthlyRent: 4500 },
      fakePrisma
    );
    assert.equal(defaultRoom.capacity, 4);

    await assert.rejects(
      RoomsService.createRoom({ roomNumber: '103', monthlyRent: 4500, capacity: 5 }, fakePrisma),
      /Room capacity cannot exceed 4/
    );
  });
});

const roomAssignmentFixture = (t: TestContext, options: { sameRoom?: boolean; full?: boolean; maintenance?: boolean; failure?: boolean; creating?: boolean } = {}) => {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: 'postgresql://test:test@localhost:5432/test' }) });
  t.after(() => client.$disconnect());
  t.mock.method(settings, 'getSettingValue', async () => '4');
  const now = new Date();
  const tenant: Tenant = {
    id: 55, userId: null, roomId: 22, fullName: 'QA', phone: null, email: null,
    studentId: null, course: null, yearLevel: null, citizenId: null, address: null,
    birthDate: null, emergencyContact: null, emergencyName: null, emergencyRelation: null,
    preferredRoomType: null, notes: null, contractData: null, idCardImagePath: null,
    paymentSlipPath: null, status: 'ACTIVE', checkInDate: null, checkOutDate: null,
    isActive: true, createdAt: now, updatedAt: now,
  };
  const room: Room = {
    id: options.sameRoom ? 22 : 23, roomNumber: 'QA', floor: 1,
    capacity: 4, monthlyRent: new Prisma.Decimal(1000), description: null,
    status: options.maintenance ? 'MAINTENANCE' : 'AVAILABLE', createdAt: now, updatedAt: now,
  };
  const tenants = { ...client.tenant };
  const rooms = { ...client.room };
  const payments = { ...client.payment };
  const confirmDeposit = t.mock.method(payments, 'updateMany', async () => ({ count: 1 }));
  const users = { ...client.user };
  t.mock.method(users, 'findUnique', async () => ({ version: 1 }));
  t.mock.method(users, 'updateMany', async () => ({ count: 1 }));
  const lock = t.mock.fn(async () => []);
  t.mock.method(tenants, 'findUnique', async () => options.creating ? null : tenant);
  t.mock.method(tenants, 'create', async ({ data }: Prisma.TenantCreateArgs) => ({
    ...tenant, userId: 'userId' in data ? data.userId ?? null : null,
    roomId: 'roomId' in data ? data.roomId ?? null : null, status: data.status ?? 'PENDING',
  }));
  const update = t.mock.method(tenants, 'update', async () => {
    if (options.failure) throw new Error('Simulated tenant write failure');
    return { ...tenant, roomId: room.id };
  });
  t.mock.method(tenants, 'count', async () => 4);
  const findRoom = t.mock.method(rooms, 'findUnique', async () => ({
    ...room, tenants: Array.from({ length: options.full ? 4 : 3 }, (_, index) => ({ ...tenant, id: index + 1 })),
  }));
  const updateRoom = t.mock.method(rooms, 'update', async () => room);
  const tx = new Proxy(client, {
    get(target, key, receiver) {
      if (key === 'tenant') return tenants;
      if (key === 'user') return users;
      if (key === 'room') return rooms;
      if (key === 'payment') return payments;
      if (key === '$queryRaw') return lock;
      return Reflect.get(target, key, receiver);
    },
  });
  const transaction = t.mock.fn((run: (db: Prisma.TransactionClient) => Promise<Tenant>) => run(tx));
  const db = new Proxy(client, {
    get(target, key, receiver) {
      if (key === '$transaction') return transaction;
      return Reflect.get(target, key, receiver);
    },
  });
  return { db, update, updateRoom, lock, findRoom, transaction, confirmDeposit };
};

describe('tenant room assignment', () => {
  it('allows keeping the same full room by excluding the current tenant', async (t) => {
    const f = roomAssignmentFixture(t, { sameRoom: true });
    const updated = await TenantsService.updateTenant(55, { roomId: 22 }, f.db);
    assert.equal(updated.roomId, 22);
    assert.deepEqual(f.findRoom.mock.calls[0].arguments[0]?.include?.tenants, {
      where: { isActive: true, status: { in: ['PENDING', 'APPROVED', 'ACTIVE'] }, id: { not: 55 } },
    });
    assert.equal(f.transaction.mock.callCount(), 1);
    assert.equal(f.lock.mock.callCount(), 2);
  });

  it('rejects a full destination without changing the old room or tenant', async (t) => {
    const f = roomAssignmentFixture(t, { full: true });
    await assert.rejects(TenantsService.updateTenant(55, { roomId: 23 }, f.db), { statusCode: 409 });
    assert.equal(f.update.mock.callCount(), 0);
    assert.equal(f.updateRoom.mock.callCount(), 0);
  });

  it('rejects assigning a tenant to a room under maintenance', async (t) => {
    const f = roomAssignmentFixture(t, { maintenance: true });
    await assert.rejects(TenantsService.updateTenant(55, { roomId: 23 }, f.db), { statusCode: 409 });
    assert.equal(f.update.mock.callCount(), 0);
    assert.equal(f.updateRoom.mock.callCount(), 0);
  });

  it('does not update room status when saving the tenant fails', async (t) => {
    const f = roomAssignmentFixture(t, { failure: true });
    await assert.rejects(TenantsService.updateTenant(55, { roomId: 23 }, f.db), /Simulated tenant write failure/);
    assert.equal(f.updateRoom.mock.callCount(), 0);
  });
});


describe('admin housing deposit approval', () => {
  it('records approval on the linked paid deposit inside the same tenant transaction and only once', async (t) => {
    const f = roomAssignmentFixture(t, { sameRoom: true });
    await TenantsService.updateTenant(55, { status: 'APPROVED', roomId: 22 }, f.db);
    assert.equal(f.confirmDeposit.mock.calls.length, 1);
    const args = f.confirmDeposit.mock.calls[0].arguments[0];
    assert.ok(args);
    assert.deepEqual(args.where, { housingTenantId: 55, billId: null, status: 'PAID', housingApprovedAt: null });
    assert.ok(args.data.housingApprovedAt instanceof Date);
  });
});


describe('resident face enrollment menu completion', () => {
  function fixture(count = 5, revoked = false, active = true) {
    const logs: Array<{ path: string }> = [];
    const tenant = { id: 55, isActive: active, status: 'APPROVED', roomId: 22, birthDate: null,
      user: { id: 99, faceRevokedAt: revoked ? new Date() : null, _count: { faceEnrollmentPhotos: count }, accessLogs: logs } };
    const db = { tenant: { findUnique: async () => tenant }, $queryRaw: async () => [],
      accessLog: { findFirst: async () => logs[0] ?? null, create: async ({ data }: { data: { path: string } }) => { logs.push({ path: data.path }); return data; } },
    } as unknown as DbClient;
    return { db, logs, tenant };
  }
  it('completion is durable, idempotent and does not expose internal metadata in the resident profile', async () => {
    const f = fixture();
    assert.equal((await TenantsService.getTenantByUserId(99, f.db))?.faceEnrollmentComplete, false);
    await TenantsService.completeFaceEnrollment(99, f.db);
    await TenantsService.completeFaceEnrollment(99, f.db);
    assert.equal(f.logs.length, 1);
    const profile = await TenantsService.getTenantByUserId(99, f.db);
    assert.equal(profile?.faceEnrollmentComplete, true);
    assert.equal('_count' in (profile?.user ?? {}), false);
    assert.equal('accessLogs' in (profile?.user ?? {}), false);
  });
  it('partial photos and revoked owners cannot mark enrollment complete', async () => {
    for (const f of [fixture(4), fixture(5, true)]) {
      await assert.rejects(TenantsService.completeFaceEnrollment(99, f.db), /ยังบันทึกภาพ/u);
      assert.equal(f.logs.length, 0);
    }
  });
  it('inactive residents cannot mark enrollment complete', async () => {
    const f = fixture(5, false, false);
    await assert.rejects(TenantsService.completeFaceEnrollment(99, f.db), /ต้องเป็นผู้พัก/u);
  });
  it('photo deletion or a new tenant profile clears completion despite an old marker', async () => {
    const f = fixture(); await TenantsService.completeFaceEnrollment(99, f.db);
    f.tenant.user._count.faceEnrollmentPhotos = 0;
    assert.equal((await TenantsService.getTenantByUserId(99, f.db))?.faceEnrollmentComplete, false);
    f.tenant.user._count.faceEnrollmentPhotos = 5; f.tenant.id = 56;
    assert.equal((await TenantsService.getTenantByUserId(99, f.db))?.faceEnrollmentComplete, false);
  });
});
