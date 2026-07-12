import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/smart_dormitory?schema=public';

const { UsersService } = require('../../src/modules/users/users.service');
const { TenantsService } = require('../../src/modules/tenants/tenants.service');
const { RoomsService } = require('../../src/modules/rooms/rooms.service');

describe('core domain services', () => {
  it('creates a user with a hashed password and returns the public profile', async () => {
    const fakePrisma = {
      user: {
        findUnique: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => ({
          id: 101,
          email: data.email,
          role: data.role,
          firstName: data.firstName,
          lastName: data.lastName,
          password: data.password,
        }),
      },
    };

    const user = await UsersService.createUser(
      {
        email: 'student@example.com',
        password: 'Password123',
        firstName: 'Ada',
        lastName: 'Lovelace',
      },
      fakePrisma as any
    );

    assert.equal(user.email, 'student@example.com');
    assert.equal(user.role, 'STUDENT');
    assert.equal(user.id, 101);
    assert.notEqual(user.password, 'Password123');
  });

  it('creates a tenant linked to a user and room', async () => {
    const fakePrisma = {
      tenant: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({
          id: 55,
          ...data,
        }),
      },
      user: {
        findUnique: async () => ({ id: 11 }),
      },
      room: {
        findUnique: async () => ({ id: 22 }),
      },
    };

    const tenant = await TenantsService.createTenant(
      {
        userId: 11,
        roomId: 22,
        fullName: 'Jane Doe',
        phone: '+66811234567',
      },
      fakePrisma as any
    );

    assert.equal(tenant.id, 55);
    assert.equal(tenant.userId, 11);
    assert.equal(tenant.roomId, 22);
  });

  it('creates a room with a normalized room number', async () => {
    const fakePrisma = {
      room: {
        findUnique: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => ({
          id: 77,
          ...data,
        }),
      },
    };

    const room = await RoomsService.createRoom(
      {
        roomNumber: ' 101 ',
        monthlyRent: 4500,
        capacity: 2,
      },
      fakePrisma as any
    );

    assert.equal(room.roomNumber, '101');
    assert.equal(room.monthlyRent, 4500);
  });
});
