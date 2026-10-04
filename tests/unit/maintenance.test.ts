import assert from 'node:assert/strict';
import { describe, it, TestContext } from 'node:test';
import { MaintenanceCategory, MaintenanceStatus, MaintenanceTicket, Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { MaintenanceService } from '../../src/modules/maintenance/maintenance.service';
import { MaintenanceRepository } from '../../src/modules/maintenance/maintenance.repository';
import { createMaintenanceTicketSchema, updateMaintenanceStatusSchema } from '../../src/modules/maintenance/maintenance.dto';
import * as gateway from '../../src/realtime/notification-gateway';
import express from 'express';
import jwt from 'jsonwebtoken';
import maintenanceRoutes from '../../src/modules/maintenance/maintenance.routes';
import { errorHandler } from '../../src/middlewares/error-handler';
import { getJwtSecret } from '../../src/shared/env';

const ticket: MaintenanceTicket = {
  id: 1, tenantId: 2, roomId: 3,
  category: MaintenanceCategory.ELECTRICAL,
  description: 'Test repair request', contactTime: null,
  status: MaintenanceStatus.PENDING,
  assignedTechnicianId: null, note: null, resolvedAt: null,
  createdAt: new Date('2026-10-04T00:00:00Z'),
  updatedAt: new Date('2026-10-04T00:00:00Z'),
};

const quotaFixture = (t: TestContext, recorded: number, existing = 0) => {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: 'postgresql://test:test@localhost:5432/test' }) });
  t.after(() => client.$disconnect());
  const tickets = { ...client.maintenanceTicket };
  const logs = { ...client.accessLog };
  const tenants = { ...client.tenant };
  t.mock.method(tenants, 'findUnique', async () => ({ userId: 8 }));
  const countTickets = t.mock.method(tickets, 'count', async () => Math.max(existing - recorded, 0));
  const countLogs = t.mock.method(logs, 'findMany', async () => Array.from({ length: recorded }, (_, index) => ({ path: `/api/maintenance/${index + 1}` })));
  const create = t.mock.method(tickets, 'create', async () => ticket);
  const record = t.mock.method(logs, 'create', async () => ({ id: 1, userId: 8, method: 'MAINTENANCE_CREATED', path: '/api/maintenance', ip: null, duration: null, createdAt: ticket.createdAt }));
  const lock = t.mock.fn(async () => []);
  const tx = new Proxy(client, {
    get(target, key, receiver) {
      if (key === 'maintenanceTicket') return tickets;
      if (key === 'accessLog') return logs;
      if (key === 'tenant') return tenants;
      if (key === '$queryRaw') return lock;
      return Reflect.get(target, key, receiver);
    },
  });
  const db = new Proxy(client, {
    get(target, key, receiver) {
      if (key === '$transaction') return (run: (transaction: Prisma.TransactionClient) => Promise<MaintenanceTicket>) => run(tx);
      return Reflect.get(target, key, receiver);
    },
  });
  return { db, create, record, lock, countTickets, countLogs };
};

describe('Maintenance daily submission quota', () => {
  const input: Prisma.MaintenanceTicketCreateInput = { tenant: { connect: { id: 2 } }, description: ticket.description, category: ticket.category };
  it('allows the third success and records it in the same locked transaction', async (t) => {
    const f = quotaFixture(t, 2, 2);
    assert.equal(await MaintenanceRepository.createTicketWithinDailyLimit(input, 2, new Date('2026-10-04T16:59:59Z'), f.db), ticket);
    assert.equal(f.lock.mock.callCount(), 1);
    assert.equal(f.record.mock.callCount(), 1);
    assert.deepEqual(f.countTickets.mock.calls[0].arguments[0]?.where?.id, { notIn: [1, 2] });
    assert.deepEqual(f.countLogs.mock.calls[0].arguments[0]?.where?.createdAt, {
      gte: new Date('2026-10-03T17:00:00Z'), lt: new Date('2026-10-04T17:00:00Z'),
    });
  });
  for (const [recorded, existing] of [[3, 0], [0, 3]]) {
    it(`rejects a fourth submission with recorded=${recorded} existing=${existing}`, async (t) => {
      const f = quotaFixture(t, recorded, existing);
      await assert.rejects(MaintenanceRepository.createTicketWithinDailyLimit(input, 2, new Date('2026-10-04T00:00:00Z'), f.db), { statusCode: 429 });
      assert.equal(f.create.mock.callCount(), 0);
      assert.equal(f.record.mock.callCount(), 0);
    });
  }
  it('uses the next Thai calendar day starting at 17:00 UTC', async (t) => {
    const f = quotaFixture(t, 0);
    await MaintenanceRepository.createTicketWithinDailyLimit(input, 2, new Date('2026-10-04T17:00:00Z'), f.db);
    assert.deepEqual(f.countTickets.mock.calls[0].arguments[0]?.where?.createdAt, {
      gte: new Date('2026-10-04T17:00:00Z'), lt: new Date('2026-10-05T17:00:00Z'),
    });
  });
  it('does not record quota when ticket creation fails', async (t) => {
    const f = quotaFixture(t, 0);
    const error = new Error('Simulated write failure');
    f.create.mock.mockImplementation(async () => { throw error; });
    await assert.rejects(MaintenanceRepository.createTicketWithinDailyLimit(input, 2, new Date(), f.db), error);
    assert.equal(f.record.mock.callCount(), 0);
  });
});

it('rate limits creation and upload together before database work', async (t) => {
  const app = express();
  app.use(express.json());
  app.use('/api/maintenance', maintenanceRoutes);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const token = jwt.sign({ id: 876543, role: 'STUDENT' }, getJwtSecret());
  const url = `http://127.0.0.1:${address.port}/api/maintenance`;
  const write = t.mock.method(MaintenanceRepository, 'createTicketWithinDailyLimit', async () => ticket);
  for (let index = 0; index < 10; index++) {
    const response = await fetch(index % 2 ? `${url}/upload` : url, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
    });
    await response.text();
    assert.equal(response.status, 400);
  }
  const limited = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
  const body = await limited.json();
  assert.equal(body.statusCode, 429);
  assert.equal(write.mock.callCount(), 0);
});

describe('MaintenanceService validation and transitions', () => {
  it('only allows closing a resolved ticket and prevents deletion', async (t) => {
    t.mock.method(MaintenanceRepository, 'getTicketById', async () => ({ ...ticket, status: MaintenanceStatus.RESOLVED }));
    const write = t.mock.method(MaintenanceRepository, 'updateTicketStatus', async () => ({ ...ticket, status: MaintenanceStatus.CLOSED }));
    const remove = t.mock.method(MaintenanceRepository, 'deleteTicket', async () => ticket);
    t.mock.method(gateway, 'publishAdminAlert', () => {});
    for (const target of Object.values(MaintenanceStatus).filter((status) => status !== MaintenanceStatus.CLOSED)) {
      await assert.rejects(MaintenanceService.updateTicketStatus(1, target), { statusCode: 409 });
    }
    await assert.rejects(MaintenanceService.deleteTicket(1), { statusCode: 409 });
    assert.equal(remove.mock.callCount(), 0);
    assert.equal(write.mock.callCount(), 0);
    assert.equal((await MaintenanceService.updateTicketStatus(1, 'CLOSED')).status, 'CLOSED');
  });
  for (const status of [MaintenanceStatus.CLOSED, MaintenanceStatus.CANCELLED]) {
    it(`rejects all status and note changes for ${status}`, async (t) => {
      t.mock.method(MaintenanceRepository, 'getTicketById', async () => ({ ...ticket, status }));
      const write = t.mock.method(MaintenanceRepository, 'updateTicketStatus', async () => ticket);
      const publish = t.mock.method(gateway, 'publishAdminAlert', () => {});
      for (const target of Object.values(MaintenanceStatus)) {
        await assert.rejects(MaintenanceService.updateTicketStatus(1, target, 'Changed note'), { statusCode: 409 });
      }
      assert.equal(write.mock.callCount(), 0);
      assert.equal(publish.mock.callCount(), 0);
    });

    it(`preserves ${status} tickets when deletion is requested`, async (t) => {
      t.mock.method(MaintenanceRepository, 'getTicketById', async () => ({ ...ticket, status }));
      const remove = t.mock.method(MaintenanceRepository, 'deleteTicket', async () => ticket);
      await assert.rejects(MaintenanceService.deleteTicket(1), { statusCode: 409 });
      assert.equal(remove.mock.callCount(), 0);
    });
  }

  it('continues to delete active tickets and reports missing tickets', async (t) => {
    t.mock.method(MaintenanceRepository, 'getTicketById', async (id: number) => id === 1 ? ticket : null);
    const remove = t.mock.method(MaintenanceRepository, 'deleteTicket', async () => ticket);
    assert.equal(await MaintenanceService.deleteTicket(1), ticket);
    await assert.rejects(MaintenanceService.deleteTicket(99), { statusCode: 404 });
    assert.equal(remove.mock.callCount(), 1);
  });

  it('guards update and delete against terminal status at database write time', async (t) => {
    // Isolate delegates from other suites; all database operations below are mocked.
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: 'postgresql://test:test@localhost:5432/test' }) });
    t.after(() => db.$disconnect());
    // Prisma delegates are proxies; use a typed plain copy for method mocks.
    const delegate = { ...db.maintenanceTicket };
    const update = t.mock.method(delegate, 'update', async () => ticket);
    const remove = t.mock.method(delegate, 'delete', async () => ticket);
    const mockDb = new Proxy(db, {
      get(target, property, receiver) {
        return property === 'maintenanceTicket' ? delegate : Reflect.get(target, property, receiver);
      },
    });
    await MaintenanceRepository.updateTicketStatus(1, { status: MaintenanceStatus.APPROVED }, mockDb);
    await MaintenanceRepository.deleteTicket(1, mockDb);
    assert.deepEqual(update.mock.calls[0].arguments[0]?.where, { id: 1, status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] } });
    await MaintenanceRepository.updateTicketStatus(1, { status: MaintenanceStatus.CLOSED }, mockDb);
    assert.deepEqual(update.mock.calls[1].arguments[0]?.where, { id: 1, status: { notIn: ['CLOSED', 'CANCELLED'] } });
    assert.deepEqual(remove.mock.calls[0].arguments[0]?.where, { id: 1, status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] } });
  });

  it('returns conflict without publishing when a ticket closes during update', async (t) => {
    let reads = 0;
    t.mock.method(MaintenanceRepository, 'getTicketById', async () => ({
      ...ticket, status: reads++ === 0 ? MaintenanceStatus.PENDING : MaintenanceStatus.CLOSED,
    }));
    t.mock.method(MaintenanceRepository, 'updateTicketStatus', async () => {
      throw new Prisma.PrismaClientKnownRequestError('Record not found', { code: 'P2025', clientVersion: 'test' });
    });
    const publish = t.mock.method(gateway, 'publishAdminAlert', () => {});
    await assert.rejects(MaintenanceService.updateTicketStatus(1, 'APPROVED'), { statusCode: 409 });
    assert.equal(publish.mock.callCount(), 0);
  });

  it('returns conflict when a ticket is cancelled during deletion', async (t) => {
    let reads = 0;
    t.mock.method(MaintenanceRepository, 'getTicketById', async () => ({
      ...ticket, status: reads++ === 0 ? MaintenanceStatus.PENDING : MaintenanceStatus.CANCELLED,
    }));
    t.mock.method(MaintenanceRepository, 'deleteTicket', async () => {
      throw new Prisma.PrismaClientKnownRequestError('Record not found', { code: 'P2025', clientVersion: 'test' });
    });
    await assert.rejects(MaintenanceService.deleteTicket(1), { statusCode: 409 });
  });

  it('rejects invalid categories before writing a ticket', async (t) => {
    const write = t.mock.method(MaintenanceRepository, 'createTicketWithinDailyLimit', async () => ticket);
    await assert.rejects(
      MaintenanceService.createTicket({ tenantId: 2, category: 'INVALID', description: ticket.description }),
      { statusCode: 400, message: 'Invalid maintenance category' },
    );
    assert.equal(write.mock.callCount(), 0);
  });

  it('accepts each Prisma category and forwards it without a cast', async (t) => {
    const databaseError = new Error('Simulated database failure');
    const write = t.mock.method(MaintenanceRepository, 'createTicketWithinDailyLimit', async () => { throw databaseError; });
    for (const category of Object.values(MaintenanceCategory)) {
      await assert.rejects(
        MaintenanceService.createTicket({ tenantId: 2, category, description: ticket.description }),
        databaseError,
      );
      assert.equal(write.mock.calls.at(-1)?.arguments[0]?.category, category);
    }
  });

  it('validates actual strings rather than stringifying malformed inputs', () => {
    assert.equal(createMaintenanceTicketSchema.category('ELECTRICAL'), true);
    assert.equal(createMaintenanceTicketSchema.category(['ELECTRICAL']), false);
    assert.equal(updateMaintenanceStatusSchema.status('APPROVED'), true);
    assert.equal(updateMaintenanceStatusSchema.status(['APPROVED']), false);
    assert.equal(updateMaintenanceStatusSchema.status('INVALID'), false);
  });

  it('rejects invalid statuses before querying or writing', async (t) => {
    const read = t.mock.method(MaintenanceRepository, 'getTicketById', async () => ticket);
    const write = t.mock.method(MaintenanceRepository, 'updateTicketStatus', async () => ticket);
    await assert.rejects(MaintenanceService.updateTicketStatus(1, 'INVALID'), { statusCode: 400 });
    assert.equal(read.mock.callCount(), 0);
    assert.equal(write.mock.callCount(), 0);
  });

  it('returns 404 for a missing ticket without writing', async (t) => {
    t.mock.method(MaintenanceRepository, 'getTicketById', async () => null);
    const write = t.mock.method(MaintenanceRepository, 'updateTicketStatus', async () => ticket);
    await assert.rejects(MaintenanceService.updateTicketStatus(1, 'APPROVED'), { statusCode: 404 });
    assert.equal(write.mock.callCount(), 0);
  });

  it('rejects skipped transitions even when called directly', async (t) => {
    t.mock.method(MaintenanceRepository, 'getTicketById', async () => ticket);
    const write = t.mock.method(MaintenanceRepository, 'updateTicketStatus', async () => ticket);
    const publish = t.mock.method(gateway, 'publishAdminAlert', () => {});
    await assert.rejects(MaintenanceService.updateTicketStatus(1, 'CLOSED'), { statusCode: 409 });
    assert.equal(write.mock.callCount(), 0);
    assert.equal(publish.mock.callCount(), 0);
  });

  it('persists an allowed transition before publishing', async (t) => {
    const events: string[] = [];
    const updated = { ...ticket, status: MaintenanceStatus.APPROVED, note: 'Approved' };
    t.mock.method(MaintenanceRepository, 'getTicketById', async () => ticket);
    const write = t.mock.method(MaintenanceRepository, 'updateTicketStatus', async () => {
      events.push('persist');
      return updated;
    });
    t.mock.method(gateway, 'publishAdminAlert', () => { events.push('publish'); });
    assert.equal(await MaintenanceService.updateTicketStatus(1, 'APPROVED', 'Approved'), updated);
    assert.deepEqual(write.mock.calls[0].arguments.slice(0, 2), [1, { status: 'APPROVED', note: 'Approved' }]);
    assert.deepEqual(events, ['persist', 'publish']);
  });

  it('does not publish when persistence fails', async (t) => {
    const databaseError = new Error('Simulated database failure');
    t.mock.method(MaintenanceRepository, 'getTicketById', async () => ticket);
    t.mock.method(MaintenanceRepository, 'updateTicketStatus', async () => { throw databaseError; });
    const publish = t.mock.method(gateway, 'publishAdminAlert', () => {});
    await assert.rejects(MaintenanceService.updateTicketStatus(1, 'APPROVED'), databaseError);
    assert.equal(publish.mock.callCount(), 0);
  });
});
