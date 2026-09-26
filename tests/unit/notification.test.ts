import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import NotificationController from '../../src/modules/notifications/notification.controller';
import NotificationService from '../../src/modules/notifications/notification.service';
import { validateNotificationPayload } from '../../src/modules/notifications/notification.dto';
import NotificationPreferenceController from '../../src/modules/notifications/notification-preferences.controller';
import { startNotificationWorker, stopNotificationWorker } from '../../src/workers/notificationWorker';
import { AuthenticatedRequest } from '../../src/middlewares/auth-jwt';
import { Response } from 'express';
import { DbClient } from '../../src/database/db';
import { NotificationChannel, NotificationStatus, NotificationType, Prisma, Role } from '@prisma/client';

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
    const req = {
      user: { id: 2, role: Role.STUDENT },
      query: {},
    } as unknown as AuthenticatedRequest;

    let responseStatusCode = 0;
    let responseBody: unknown = undefined;

    const res = {
      status(code: number) {
        responseStatusCode = code;
        return this;
      },
      json(payload: unknown) {
        responseBody = payload;
        return this;
      },
    } as unknown as Response;

    const next = () => {
      throw new Error('next should not be called');
    };

    const original = NotificationService.prototype.listNotifications;
    NotificationService.prototype.listNotifications = async () => [{
      id: 1,
      providerId: null,
      templateId: null,
      tenantId: null,
      userId: 2,
      channel: NotificationChannel.SMS,
      type: NotificationType.GENERIC,
      recipientPhone: null,
      recipientEmail: null,
      payload: null,
      status: NotificationStatus.PENDING,
      providerMessageId: null,
      attempts: 0,
      lastError: null,
      scheduledAt: null,
      sentAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }];

    try {
      await NotificationController.listNotifications(req, res, next);
      assert.equal(responseStatusCode, 200);
      const parsedBody = responseBody as { data: Array<{ id: number; status: string }> };
      assert.equal(parsedBody.data[0]?.id, 1);
      assert.equal(parsedBody.data[0]?.status, 'PENDING');
    } finally {
      NotificationService.prototype.listNotifications = original;
    }
  });

  it('retries failed sends with backoff and updates status', async () => {
    const notificationRecord = {
      id: 2,
      providerId: null,
      tenantId: null,
      userId: null,
      recipientEmail: null,
      providerMessageId: null,
      lastError: null,
      scheduledAt: null,
      sentAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      channel: NotificationChannel.SMS,
      type: NotificationType.GENERIC,
      attempts: 0,
      status: NotificationStatus.PENDING,
      payload: '{"message":"hi"}',
      templateId: null,
      recipientPhone: '+66912345678',
    };
    const updates: Prisma.NotificationUpdateArgs[] = [];
    let attemptCount = 0;

    const mockDb = {
      notification: {
        findUnique: async ({ where }: Prisma.NotificationFindUniqueArgs) => (where.id === 2 ? { ...notificationRecord } : null),
        update: async (args: Prisma.NotificationUpdateArgs) => {
          updates.push(args);
          return { ...notificationRecord, ...args.data };
        },
      },
      notificationPreference: {
        findFirst: async () => null,
      },
      notificationProvider: {
        findFirst: async () => ({ id: 1, name: 'stub', channel: NotificationChannel.SMS, config: '{}', isActive: true, createdAt: new Date(), updatedAt: new Date() }),
      },
      notificationTemplate: {
        findUnique: async () => null,
      },
    } as unknown as DbClient;

    const simpleProvider = await import('../../src/modules/notifications/provider/simpleProvider');
    const providerModule = simpleProvider.default ?? simpleProvider;
    const originalSend = providerModule.send;
    providerModule.send = async () => {
      attemptCount += 1;
      if (attemptCount < 2) {
        throw new Error('temporary failure');
      }
      return { id: 'ok', status: 'ok' };
    };

    const svc = new NotificationService(mockDb, providerModule);

    try {
      await svc.sendNotification(2);
      assert.equal(attemptCount, 2);
      assert.equal(updates.at(-1)?.data?.status, 'SENT');
    } finally {
      providerModule.send = originalSend;
    }
  });

  it('lists notification preferences through the controller', async () => {
    const req = { user: { id: 7, role: Role.STUDENT } } as unknown as AuthenticatedRequest;
    let responseStatusCode = 0;
    let responseBody: unknown = undefined;

    const res = {
      status(code: number) {
        responseStatusCode = code;
        return this;
      },
      json(payload: unknown) {
        responseBody = payload;
        return this;
      },
    } as unknown as Response;

    const controllerPrototype = NotificationPreferenceController.prototype as unknown as Record<string, () => Promise<unknown>>;
    const original = controllerPrototype.getPreferences;
    controllerPrototype.getPreferences = async () => [{
      id: 1,
      tenantId: null,
      userId: 7,
      channel: NotificationChannel.SMS,
      optedOut: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }];

    try {
      await NotificationPreferenceController.listPreferences(req, res, () => { throw new Error('next should not be called'); });
      assert.equal(responseStatusCode, 200);
      const parsedBody = responseBody as { data: Array<{ channel: string; optedOut: boolean }> };
      assert.equal(parsedBody.data[0]?.channel, 'SMS');
      assert.equal(parsedBody.data[0]?.optedOut, false);
    } finally {
      controllerPrototype.getPreferences = original;
    }
  });

  it('resolves recipient phone from tenant data when scheduling notifications', async () => {
    const created: Prisma.NotificationCreateInput[] = [];
    const mockDb = {
      tenant: {
        findUnique: async () => ({ id: 1, phone: '+66912345678', user: null }),
      },
      user: {
        findUnique: async () => null,
      },
      notification: {
        create: async ({ data }: Prisma.NotificationCreateArgs) => {
          created.push(data as Prisma.NotificationCreateInput);
          return {
            id: 1,
            providerId: null,
            templateId: null,
            tenantId: null,
            userId: null,
            channel: NotificationChannel.SMS,
            type: NotificationType.GENERIC,
            recipientPhone: data.recipientPhone ?? null,
            recipientEmail: null,
            payload: data.payload ?? null,
            status: NotificationStatus.PENDING,
            providerMessageId: null,
            attempts: 0,
            lastError: null,
            scheduledAt: null,
            sentAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      },
    } as unknown as DbClient;

    const svc = new NotificationService(mockDb);
    await svc.scheduleNotification({ tenantId: 1, channel: 'SMS', type: 'GENERIC', payload: '{}' });

    assert.equal(created[0]?.recipientPhone, '+66912345678');
  });

  it('starts and stops the notification worker to process pending notifications', async () => {
    let processed = 0;

    const mockDb = {
      notification: {
        findMany: async () => [{ id: 42 }],
        count: async () => 0,
        findUnique: async () => ({ id: 42, channel: NotificationChannel.SMS, attempts: 0, payload: '{"message":"hi"}', templateId: null }),
        update: async () => ({ status: NotificationStatus.SENT }),
      },
      notificationPreference: {
        findFirst: async () => null,
      },
      notificationProvider: {
        findFirst: async () => ({ id: 1, name: 'stub', channel: NotificationChannel.SMS, config: '{}', isActive: true }),
      },
      notificationTemplate: {
        findUnique: async () => null,
      },
    } as unknown as DbClient;

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
    const events: Prisma.NotificationAuditLogCreateInput[] = [];
    const deadLetters: Prisma.NotificationDeadLetterCreateInput[] = [];

    const mockDb = {
      notification: {
        findFirst: async () => ({ id: 7, providerMessageId: 'twilio-msg-1', status: NotificationStatus.PENDING }),
        update: async ({ where, data }: Prisma.NotificationUpdateArgs) => ({ id: where.id, ...data }),
      },
      notificationAuditLog: {
        create: async ({ data }: Prisma.NotificationAuditLogCreateArgs) => {
          events.push(data as Prisma.NotificationAuditLogCreateInput);
          return { id: 1, notificationId: 7, eventType: data.eventType, payload: data.payload ?? null, createdAt: new Date() };
        },
      },
      notificationDeadLetter: {
        findFirst: async () => null,
        create: async ({ data }: Prisma.NotificationDeadLetterCreateArgs) => {
          deadLetters.push(data as Prisma.NotificationDeadLetterCreateInput);
          return { id: 1, notificationId: 7, reason: data.reason, details: data.details ?? null, createdAt: new Date() };
        },
      },
    } as unknown as DbClient;

    const svc = new NotificationService(mockDb);
    await svc.handleProviderWebhook({ MessageSid: 'twilio-msg-1', MessageStatus: 'undelivered' });

    assert.equal(events[0]?.eventType, 'PROVIDER_WEBHOOK');
    assert.equal(deadLetters[0]?.reason, 'undelivered');
  });

  it('sends notification with provider and marks sent', async () => {
    const notificationRecord = { id: 1, channel: NotificationChannel.SMS, attempts: 0, payload: '{"message":"hi"}', templateId: null };
    let updatedArgs: Prisma.NotificationUpdateArgs | null = null;

    const mockDb = {
      notification: {
        findUnique: async ({ where }: Prisma.NotificationFindUniqueArgs) => (where.id === 1 ? { ...notificationRecord } : null),
        update: async (args: Prisma.NotificationUpdateArgs) => {
          updatedArgs = args;
          return { ...notificationRecord, ...args.data };
        },
      },
      notificationPreference: {
        findFirst: async () => null,
      },
      notificationProvider: {
        findFirst: async () => ({ id: 1, name: 'stub', channel: NotificationChannel.SMS, config: '{}', isActive: true }),
      },
      notificationTemplate: {
        findUnique: async () => null,
      },
    } as unknown as DbClient;

    const svc = new NotificationService(mockDb);

    const result = await svc.sendNotification(1);

    assert.equal(typeof (result as { id?: string }).id, 'string');
    if (updatedArgs) {
      const updateRef = updatedArgs as Prisma.NotificationUpdateArgs;
      assert.equal(updateRef.where.id, 1);
      assert.equal(updateRef.data.status, 'SENT');
      assert.equal(updateRef.data.attempts, 1);
    }
  });
});
