import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';
import { checkOperations } from '../../scripts/check-operations.js';

describe('operations monitoring snapshot', () => {
  it('reports a healthy snapshot when queues and recovery controls are clear', async () => {
    const snapshot = await checkOperations(poolWith([
      row({ total: 0, oldest_seconds: null }),
      row({ total: 0 }),
      row({ total: 0, oldest_seconds: null }),
      row({ total: 0 }),
      row({ total: 0 }),
      row({ total: 0 }),
      row({ total: 0 })
    ]), { maxPendingMinutes: 15, emailLockSeconds: 300, outboxLockSeconds: 30 });

    assert.equal(snapshot.healthy, true);
    assert.deepEqual(snapshot.failures, []);
    assert.equal(snapshot.email.oldestDueSeconds, 0);
  });

  it('fails closed when due work, leases, reservations, or finance recovery need attention', async () => {
    const snapshot = await checkOperations(poolWith([
      row({ total: 4, oldest_seconds: 901 }),
      row({ total: 1 }),
      row({ total: 3, oldest_seconds: 1200 }),
      row({ total: 2 }),
      row({ total: 5 }),
      row({ total: 1 }),
      row({ total: 1 })
    ]), { maxPendingMinutes: 15, emailLockSeconds: 300, outboxLockSeconds: 30 });

    assert.equal(snapshot.healthy, false);
    assert.deepEqual(snapshot.failures, [
      'email queue has overdue work',
      'email queue has stale processing leases',
      'support outbox has overdue work',
      'support outbox has stale publisher leases',
      'expired inventory reservations require release',
      'refunds require finance attention',
      'payout initiations require reconciliation'
    ]);
  });
});

function row(value: Record<string, number | null>): unknown {
  return [[value], []];
}

function poolWith(responses: unknown[]): Pool {
  return { query: async () => responses.shift() } as unknown as Pool;
}
