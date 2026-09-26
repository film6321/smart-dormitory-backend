import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canTransitionBillStatus, canTransitionMaintenanceStatus, canTransitionVisitorStatus } from '../../src/shared/state-transitions';

describe('state transitions', () => {
  it('allows valid bill transitions', () => {
    assert.equal(canTransitionBillStatus('UNPAID', 'VERIFYING'), true);
    assert.equal(canTransitionBillStatus('VERIFYING', 'PAID'), true);
    assert.equal(canTransitionBillStatus('VERIFYING', 'FAILED'), true);
    assert.equal(canTransitionBillStatus('PAID', 'FAILED'), false);
  });

  it('allows valid maintenance transitions', () => {
    assert.equal(canTransitionMaintenanceStatus('PENDING', 'APPROVED'), true);
    assert.equal(canTransitionMaintenanceStatus('APPROVED', 'IN_PROGRESS'), true);
    assert.equal(canTransitionMaintenanceStatus('IN_PROGRESS', 'RESOLVED'), true);
    assert.equal(canTransitionMaintenanceStatus('RESOLVED', 'CLOSED'), true);
    assert.equal(canTransitionMaintenanceStatus('PENDING', 'CLOSED'), false);
  });

  it('allows valid visitor transitions', () => {
    assert.equal(canTransitionVisitorStatus('REGISTERED', 'VERIFYING'), true);
    assert.equal(canTransitionVisitorStatus('REGISTERED', 'CANCELLED'), true);
    assert.equal(canTransitionVisitorStatus('VERIFYING', 'APPROVED'), true);
    assert.equal(canTransitionVisitorStatus('APPROVED', 'CHECKED_IN'), true);
    assert.equal(canTransitionVisitorStatus('CHECKED_IN', 'CHECKED_OUT'), true);
    assert.equal(canTransitionVisitorStatus('REGISTERED', 'CHECKED_IN'), false);
  });
});
