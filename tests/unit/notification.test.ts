import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import NotificationController from '../../src/modules/notifications/notification.controller';
import NotificationService from '../../src/modules/notifications/notification.service';
import { validateNotificationPayload } from '../../src/modules/notifications/notification.dto';
import NotificationPreferenceController from '../../src/modules/notifications/notification-preferences.controller';
import { startNotificationWorker, stopNotificationWorker } from '../../src/workers/notificationWorker';

describe('NotificationService (unit)', () => {
  it('accepts a valid notification payload for SMS delivery', () => {
    const payload = {
      channel: 'SMS',
      type: 'GENERIC',
      recipientPhone: '+66912345678',
      tenantId: 1,
      payload: { message: 'Rent is due soon' },
    };

    assert.equal(validateNotificationPayload(payload), true);
  });

  it('returns notifications through the controller response wrapper', async () => {
    const req: any = { user: { id: 2, role: 'TENANT' }, query: {} };
    const res: any = {
      statusCode: 0,
      body: undefined,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: any) {
        this.body = payload;
        return this;
      }
    };
    const next = () => {
      throw new Error('next should not be called');
    };

    const original = NotificationService.prototype.listNotifications;
    NotificationService.prototype.listNotifications = async () => [{ id: 1, status: 'PENDING' }];

    try {
      await NotificationController.listNotifications(req, res, next);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.data, [{ id: 1, status: 'PENDING' }]);
    } finally {
      NotificationService.prototype.listNotifications = original;
    }
  });

  it('retries failed sends with backoff and updates status', async () => {
    const notificationRecord = { id: 2, channel: 'SMS', attempts: 0, payload: '{"message":"hi"}', templateId: null, recipientPhone: '+66912345678' };
    const updates: any[] = [];
    let attemptCount = 0;

    const mockDb: any = {
      notification: {
        findUnique: async ({ where }: any) => (where.id === 2 ? { ...notificationRecord } : null),
        update: async ({ where, data }: any) => { updates.push({ where, data }); return { ...notificationRecord, ...data }; },
      },
      notificationPreference: {
        findFirst: async () => null,
      },
      notificationProvider: {
        findFirst: async () => ({ id: 'prov-1', name: 'stub', channel: 'SMS', config: '{}', isActive: true }),
      },
      notificationTemplate: {
        findUnique: async () => null,
      }
    };

    const svc = new NotificationService(mockDb);
    const simpleProvider = await import('../../src/modules/notifications/provider/simpleProvider');
    const originalSend = simpleProvider.send;
    simpleProvider.send = async () => {
      attemptCount += 1;
      if (attemptCount < 2) {
        throw new Error('temporary failure');
      }
      return { id: 'ok', status: 'ok' };
    };

    try {
      await svc.sendNotification(2);
      assert.equal(attemptCount, 2);
      assert.equal(updates.at(-1)?.data?.status, 'SENT');
    } finally {
      simpleProvider.send = originalSend;
    }
  });

  it('lists notification preferences through the controller', async () => {
    const req: any = { user: { id: 7, role: 'TENANT' } };
    const res: any = {
      statusCode: 0,
      body: undefined,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: any) {
        this.body = payload;
        return this;
      }
    };

    const original = NotificationPreferenceController.prototype['getPreferences'];
    NotificationPreferenceController.prototype['getPreferences'] = async () => [{ channel: 'SMS', optedOut: false }];

    try {
      await NotificationPreferenceController.listPreferences(req, res, () => { throw new Error('next should not be called'); });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.data, [{ channel: 'SMS', optedOut: false }]);
    } finally {
      NotificationPreferenceController.prototype['getPreferences'] = original;
    }
  });

  it('resolves recipient phone from tenant data when scheduling notifications', async () => {
    const created: any[] = [];
    const mockDb: any = {
      tenant: {
        findUnique: async () => ({ id: 1, phone: '+66912345678', user: null }),
      },
      user: {
        findUnique: async () => null,
      },
      notification: {
        create: async ({ data }: any) => { created.push(data); return data; },
      },
    };

    const svc = new NotificationService(mockDb);
    await svc.scheduleNotification({ tenantId: 1, channel: 'SMS', type: 'GENERIC' });

    assert.equal(created[0]?.recipientPhone, '+66912345678');
  });

  it('starts and stops the notification worker to process pending notifications', async () => {
    let processed = 0;

    const mockDb: any = {
      notification: {
        findMany: async () => [{ id: 42 }],
        count: async () => 0,
        findUnique: async () => ({ id: 42, channel: 'SMS', attempts: 0, payload: '{"message":"hi"}', templateId: null }),
        update: async (_args: any) => ({ status: 'SENT' }),
      },
      notificationPreference: {
        findFirst: async () => null,
      },
      notificationProvider: {
        findFirst: async () => ({ id: 'prov-1', name: 'stub', channel: 'SMS', config: '{}', isActive: true }),
      },
      notificationTemplate: {
        findUnique: async () => null,
      }
    };

    const original = NotificationService.prototype.sendNotification;
    NotificationService.prototype.sendNotification = async () => {
      processed += 1;
      return { id: 'ok', status: 'ok' };
    };

    try {
      startNotificationWorker(mockDb, 10);
      await new Promise((resolve) => setTimeout(resolve, 30));
      await stopNotificationWorker();
      assert.ok(processed >= 1);
    } finally {
      NotificationService.prototype.sendNotification = original;
    }
  });

  it('records webhooks as audit events and moves failed deliveries to dead-letter', async () => {
    const events: any[] = [];
    const deadLetters: any[] = [];

    const mockDb: any = {
      notification: {
        findFirst: async () => ({ id: 7, providerMessageId: 'twilio-msg-1', status: 'PENDING' }),
        update: async ({ where, data }: any) => ({ id: where.id, ...data }),
      },
      notificationAuditLog: {
        create: async ({ data }: any) => { events.push(data); return data; },
      },
      notificationDeadLetter: {
        findFirst: async () => null,
        create: async ({ data }: any) => { deadLetters.push(data); return data; },
      },
    };

    const svc = new NotificationService(mockDb);
    await svc.handleProviderWebhook({ MessageSid: 'twilio-msg-1', MessageStatus: 'undelivered' });

    assert.equal(events[0]?.eventType, 'PROVIDER_WEBHOOK');
    assert.equal(deadLetters[0]?.reason, 'undelivered');
  });

  it('sends notification with provider and marks sent', async () => {
    // Arrange: mock DB with minimal methods used by the service
    const notificationRecord = { id: 1, channel: 'SMS', attempts: 0, payload: '{"message":"hi"}', templateId: null };
    let updated: any = null;

    const mockDb: any = {
      notification: {
        findUnique: async ({ where }: any) => (where.id === 1 ? { ...notificationRecord } : null),
        update: async ({ where, data }: any) => { updated = { where, data }; return { ...notificationRecord, ...data }; },
      },
      notificationPreference: {
        findFirst: async () => null,
      },
      notificationProvider: {
        findFirst: async () => ({ id: 'prov-1', name: 'stub', channel: 'SMS', config: '{}', isActive: true }),
      },
      notificationTemplate: {
        findUnique: async () => null,
      }
    };

    const svc = new NotificationService(mockDb);

    // Act
    const result = await svc.sendNotification(1);

    // Assert
    assert.equal(typeof result.id, 'string');
    assert.equal(updated?.where?.id, 1);
    assert.equal(updated?.data?.status, 'SENT');
    assert.equal(updated?.data?.attempts, 1);
  });
});
