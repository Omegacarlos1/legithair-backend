import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/database/pool.js';

interface QueueRow extends RowDataPacket { total: number | string; oldest_seconds: number | string | null }
interface CountRow extends RowDataPacket { total: number | string }

export interface OperationsSnapshot {
  healthy: boolean;
  checkedAt: string;
  email: { due: number; oldestDueSeconds: number; staleProcessing: number };
  supportOutbox: { due: number; oldestDueSeconds: number; staleLocks: number };
  reservations: { expiredActive: number };
  refunds: { needsAttention: number };
  payouts: { uncertain: number };
  failures: string[];
}

export async function checkOperations(pool: Pool, options: { maxPendingMinutes: number; emailLockSeconds: number; outboxLockSeconds: number }): Promise<OperationsSnapshot> {
  const [emailDue] = await pool.query<QueueRow[]>(`SELECT COUNT(*) AS total, TIMESTAMPDIFF(SECOND, MIN(available_at), NOW(3)) AS oldest_seconds
    FROM durable_jobs WHERE queue_name = 'email' AND status = 'pending' AND available_at <= NOW(3)`);
  const [emailStale] = await pool.query<CountRow[]>(`SELECT COUNT(*) AS total FROM durable_jobs WHERE queue_name = 'email' AND status = 'processing'
    AND locked_at < DATE_SUB(NOW(3), INTERVAL ? SECOND)`, [options.emailLockSeconds]);
  const [outboxDue] = await pool.query<QueueRow[]>(`SELECT COUNT(*) AS total, TIMESTAMPDIFF(SECOND, MIN(available_at), NOW(3)) AS oldest_seconds
    FROM outbox_events WHERE published_at IS NULL AND available_at <= NOW(3)`);
  const [outboxStale] = await pool.query<CountRow[]>(`SELECT COUNT(*) AS total FROM outbox_events WHERE published_at IS NULL
    AND locked_at < DATE_SUB(NOW(3), INTERVAL ? SECOND)`, [options.outboxLockSeconds]);
  const [reservations] = await pool.query<CountRow[]>(`SELECT COUNT(*) AS total FROM inventory_reservations
    WHERE status = 'active' AND expires_at <= NOW(3)`);
  const [refunds] = await pool.query<CountRow[]>("SELECT COUNT(*) AS total FROM refunds WHERE status = 'needs_attention'");
  const [payouts] = await pool.query<CountRow[]>("SELECT COUNT(*) AS total FROM payouts WHERE status = 'initiation_uncertain'");

  const maxSeconds = options.maxPendingMinutes * 60;
  const snapshot: OperationsSnapshot = {
    healthy: true,
    checkedAt: new Date().toISOString(),
    email: { due: count(emailDue[0]), oldestDueSeconds: age(emailDue[0]), staleProcessing: count(emailStale[0]) },
    supportOutbox: { due: count(outboxDue[0]), oldestDueSeconds: age(outboxDue[0]), staleLocks: count(outboxStale[0]) },
    reservations: { expiredActive: count(reservations[0]) },
    refunds: { needsAttention: count(refunds[0]) },
    payouts: { uncertain: count(payouts[0]) },
    failures: []
  };
  if (snapshot.email.oldestDueSeconds > maxSeconds) snapshot.failures.push('email queue has overdue work');
  if (snapshot.email.staleProcessing > 0) snapshot.failures.push('email queue has stale processing leases');
  if (snapshot.supportOutbox.oldestDueSeconds > maxSeconds) snapshot.failures.push('support outbox has overdue work');
  if (snapshot.supportOutbox.staleLocks > 0) snapshot.failures.push('support outbox has stale publisher leases');
  if (snapshot.reservations.expiredActive > 0) snapshot.failures.push('expired inventory reservations require release');
  if (snapshot.refunds.needsAttention > 0) snapshot.failures.push('refunds require finance attention');
  if (snapshot.payouts.uncertain > 0) snapshot.failures.push('payout initiations require reconciliation');
  snapshot.healthy = snapshot.failures.length === 0;
  return snapshot;
}

function count(row: CountRow | undefined): number { return Number(row?.total ?? 0); }
function age(row: QueueRow | undefined): number { return Math.max(0, Number(row?.oldest_seconds ?? 0)); }

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createDatabasePool(config);
  try {
    const snapshot = await checkOperations(pool, { maxPendingMinutes: config.OPS_MAX_PENDING_MINUTES, emailLockSeconds: config.EMAIL_JOB_LOCK_TIMEOUT_SECONDS, outboxLockSeconds: config.OUTBOX_LOCK_TIMEOUT_SECONDS });
    process.stdout.write(`${JSON.stringify(snapshot)}\n`);
    if (!snapshot.healthy) process.exitCode = 1;
  } finally { await pool.end(); }
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
