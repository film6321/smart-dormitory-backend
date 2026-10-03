import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listOnlineUserIds, markUserOnline, clearUserOnline, resolveUsersPresence } from '../../src/shared/presence';

describe('Presence Tracking (unit)', () => {
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
