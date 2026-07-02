import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import NotificationService from '../../src/modules/notifications/notification.service';

describe('NotificationService (unit)', () => {
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
