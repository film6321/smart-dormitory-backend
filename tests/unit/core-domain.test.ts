import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UsersService } from '../../src/modules/users/users.service';
import { TenantsService } from '../../src/modules/tenants/tenants.service';
import { RoomsService } from '../../src/modules/rooms/rooms.service';
import { DbClient } from '../../src/database/db';
import { Prisma, Role } from '@prisma/client';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/smart_dormitory?schema=public';

describe('core domain services', () => {
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

  it('creates a tenant linked to a user and room', async () => {
    const fakePrisma = {
      tenant: {
        // createTenant() with db injected uses TenantUncheckedCreateInput (flat userId/roomId fields).
        // When db is NOT injected it uses relational connect syntax. Support both forms.
        create: async ({ data }: Prisma.TenantCreateArgs) => {
          const flat = data as Prisma.TenantUncheckedCreateInput;
          return {
            id: 55,
            userId: (flat.userId as number | null) ?? (data.user as { connect?: { id?: number } })?.connect?.id ?? null,
            roomId: (flat.roomId as number | null) ?? (data.room as { connect?: { id?: number } })?.connect?.id ?? null,
            fullName: data.fullName ?? null,
            phone: data.phone ?? null,
            email: data.email ?? null,
            studentId: data.studentId ?? null,
            course: data.course ?? null,
            yearLevel: data.yearLevel ?? null,
            citizenId: data.citizenId ?? null,
            address: data.address ?? null,
            birthDate: data.birthDate ?? null,
            emergencyContact: data.emergencyContact ?? null,
            emergencyName: data.emergencyName ?? null,
            emergencyRelation: data.emergencyRelation ?? null,
            preferredRoomType: data.preferredRoomType ?? null,
            notes: data.notes ?? null,
            contractData: data.contractData ?? null,
            idCardImagePath: data.idCardImagePath ?? null,
            paymentSlipPath: data.paymentSlipPath ?? null,
            status: data.status ?? 'PENDING',
            checkInDate: null,
            checkOutDate: null,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      },
      user: {
        findUnique: async () => ({ id: 11 }),
      },
      room: {
        findUnique: async () => ({ id: 22 }),
      },
    } as unknown as DbClient;

    const tenant = await TenantsService.createTenant(
      {
        userId: 11,
        roomId: 22,
        fullName: 'Jane Doe',
        phone: '+66811234567',
      },
      fakePrisma
    );

    assert.equal(tenant.id, 55);
    assert.equal(tenant.userId, 11);
    assert.equal(tenant.roomId, 22);
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
          capacity: data.capacity ?? 1,
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
  });
});
