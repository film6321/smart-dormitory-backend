import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { initializeNotificationGateway, disconnectReplacedSessions, closeNotificationGateway } from '../../src/realtime/notification-gateway';
import { listOnlineUserIds, markUserOnline, clearUserOnline, resolveUsersPresence } from '../../src/shared/presence';

describe('Presence Tracking (unit)', () => {
  it('login replacement disconnects older sockets while preserving a newer concurrent session', async t => {
    const http = createServer();
    const gateway = initializeNotificationGateway(http);
    t.after(async () => { await closeNotificationGateway(); });
    const disconnected: number[] = [];
    const events: unknown[] = [];
    const sockets = [1, 2, 3].map(version => ({ data: { user: { sessionVersion: version } }, emit: (...args: unknown[]) => { events.push(args); }, disconnect: () => { disconnected.push(version); } }));
    const scope = t.mock.method(gateway, 'in', () => ({ fetchSockets: async () => sockets }));
    disconnectReplacedSessions(57, 2);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(disconnected, [1]);
    assert.deepEqual(events, [['sessionReplaced', { reason: 'SESSION_REPLACED' }]]);
    assert.deepEqual(scope.mock.calls[0].arguments, ['user:57']);
  });
  it('resolves empty user presence when user list is empty', async () => {
    const result = await resolveUsersPresence([]);
    assert.deepEqual(result, {});
  });

  it('exports presence management functions correctly', () => {
    assert.equal(typeof markUserOnline, 'function');
    assert.equal(typeof clearUserOnline, 'function');
    assert.equal(typeof listOnlineUserIds, 'function');
    assert.equal(typeof resolveUsersPresence, 'function');
  });
});
