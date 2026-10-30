import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { EmailMessage, EmailProvider } from './provider.js';

interface TokenPayload { to: string; userId?: string; token: string }
interface ReceiptPayload { to: string; userId?: string; orderId: string; receiptNumber: string; amountMinor: number; currency: string }
interface MarketingPayload { to: string; userId: string; campaignId: string; subject: string; body: string; unsubscribeUrl: string }
type JobPayload = TokenPayload | ReceiptPayload | MarketingPayload;
interface JobRow extends RowDataPacket {
  id: number; job_type: 'send_verification' | 'send_password_reset' | 'send_paid_receipt' | 'send_marketing'; deduplication_key: string | null;
  payload: string | JobPayload; attempts: number; max_attempts: number;
}
interface DeliveryRow extends RowDataPacket { id: string }
interface EligibilityRow extends RowDataPacket { eligible: number }

export async function processOneEmailJob(pool: Pool, provider: EmailProvider, lockTimeoutSeconds = 300): Promise<boolean> {
  const connection = await pool.getConnection();
  let job: JobRow | undefined;
  let payload: JobPayload | undefined;
  let deliveryId: string | undefined;
  let attemptNumber: number;
  try {
    await connection.beginTransaction();
    await connection.query(`UPDATE durable_jobs SET status = 'pending', locked_at = NULL, locked_by = NULL
      WHERE queue_name = 'email' AND status = 'processing' AND locked_at < DATE_SUB(NOW(3), INTERVAL ? SECOND)`, [lockTimeoutSeconds]);
    const [rows] = await connection.query<JobRow[]>(`SELECT id, job_type, deduplication_key, payload, attempts, max_attempts FROM durable_jobs
      WHERE queue_name = 'email' AND status = 'pending' AND available_at <= NOW(3) ORDER BY id LIMIT 1 FOR UPDATE`);
    job = rows[0];
    if (!job) { await connection.commit(); return false; }
    payload = parsePayload(job.payload);
    attemptNumber = Number(job.attempts) + 1;
    await connection.query("UPDATE durable_jobs SET status = 'processing', attempts = ?, locked_at = NOW(3), locked_by = 'local-email-worker' WHERE id = ?", [attemptNumber, job.id]);
    deliveryId = await ensureDelivery(connection, job, payload);
    await connection.query("UPDATE email_deliveries SET status = 'processing', attempts = ? WHERE id = ?", [attemptNumber, deliveryId]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }

  if (job.job_type === 'send_marketing' && !(await marketingEligible(pool, payload as MarketingPayload))) {
    await finishSuppressed(pool, job.id, deliveryId, attemptNumber, (payload as MarketingPayload).campaignId);
    return true;
  }

  try {
    await provider.send(toEmailMessage(job.job_type, payload));
    const completed = await pool.getConnection();
    try {
      await completed.beginTransaction();
      await completed.query("UPDATE durable_jobs SET status = 'completed', completed_at = NOW(3), locked_at = NULL, locked_by = NULL, last_error = NULL WHERE id = ?", [job.id]);
      await completed.query("UPDATE email_deliveries SET status = 'sent', sent_at = NOW(3), last_error = NULL WHERE id = ?", [deliveryId]);
      await completed.query("INSERT INTO email_delivery_attempts (delivery_id, attempt_number, outcome) VALUES (?, ?, 'sent')", [deliveryId, attemptNumber]);
      if (job.job_type === 'send_marketing') await completed.query(`UPDATE marketing_campaigns c SET status = 'completed', completed_at = NOW(3)
        WHERE c.id = ? AND NOT EXISTS (SELECT 1 FROM durable_jobs j WHERE j.queue_name = 'email' AND j.job_type = 'send_marketing'
          AND JSON_UNQUOTE(JSON_EXTRACT(j.payload, '$.campaignId')) = c.id AND j.status IN ('pending','processing'))`, [(payload as MarketingPayload).campaignId]);
      await completed.commit();
    } catch (error) { await completed.rollback(); throw error; } finally { completed.release(); }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : 'Email provider failed';
    const terminal = attemptNumber >= Number(job.max_attempts);
    const failed = await pool.getConnection();
    try {
      await failed.beginTransaction();
      await failed.query(`UPDATE durable_jobs SET status = ?, available_at = DATE_ADD(NOW(3), INTERVAL LEAST(attempts * attempts, 60) MINUTE),
        locked_at = NULL, locked_by = NULL, last_error = ? WHERE id = ?`, [terminal ? 'failed' : 'pending', message, job.id]);
      await failed.query('UPDATE email_deliveries SET status = ?, last_error = ? WHERE id = ?', [terminal ? 'failed' : 'retry_scheduled', message, deliveryId]);
      await failed.query("INSERT INTO email_delivery_attempts (delivery_id, attempt_number, outcome, error_message) VALUES (?, ?, 'failed', ?)", [deliveryId, attemptNumber, message]);
      await failed.commit();
    } catch (databaseError) { await failed.rollback(); throw databaseError; } finally { failed.release(); }
    throw error;
  }
}

async function ensureDelivery(connection: PoolConnection, job: JobRow, payload: JobPayload): Promise<string> {
  const [existing] = await connection.query<DeliveryRow[]>('SELECT id FROM email_deliveries WHERE durable_job_id = ?', [job.id]);
  if (existing[0]) return existing[0].id;
  const id = randomUUID();
  const marketing = job.job_type === 'send_marketing';
  const userId = 'userId' in payload ? payload.userId ?? null : null;
  await connection.query(`INSERT INTO email_deliveries (id, durable_job_id, user_id, category, template, recipient_email, logical_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, job.id, userId, marketing ? 'marketing' : 'transactional', template(job.job_type), payload.to, job.deduplication_key ?? `email-job:${job.id}`]);
  return id;
}

async function marketingEligible(pool: Pool, payload: MarketingPayload): Promise<boolean> {
  const [rows] = await pool.query<EligibilityRow[]>(`SELECT EXISTS(
    SELECT 1 FROM users u JOIN marketing_preferences p ON p.user_id = u.id
    LEFT JOIN email_suppressions s ON s.email = u.email AND s.lifted_at IS NULL
    WHERE u.id = ? AND u.email = ? AND p.opted_in_at IS NOT NULL AND p.opted_out_at IS NULL AND s.email IS NULL
  ) AS eligible`, [payload.userId, payload.to]);
  return Boolean(rows[0]?.eligible);
}

async function finishSuppressed(pool: Pool, jobId: number, deliveryId: string, attemptNumber: number, campaignId: string): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("UPDATE durable_jobs SET status = 'completed', completed_at = NOW(3), locked_at = NULL, locked_by = NULL, last_error = 'marketing recipient suppressed' WHERE id = ?", [jobId]);
    await connection.query("UPDATE email_deliveries SET status = 'suppressed', last_error = 'marketing recipient suppressed' WHERE id = ?", [deliveryId]);
    await connection.query("INSERT INTO email_delivery_attempts (delivery_id, attempt_number, outcome, error_message) VALUES (?, ?, 'suppressed', 'marketing recipient suppressed')", [deliveryId, attemptNumber]);
    await connection.query(`UPDATE marketing_campaigns c SET status = 'completed', completed_at = NOW(3)
      WHERE c.id = ? AND NOT EXISTS (SELECT 1 FROM durable_jobs j WHERE j.queue_name = 'email' AND j.job_type = 'send_marketing'
        AND JSON_UNQUOTE(JSON_EXTRACT(j.payload, '$.campaignId')) = c.id AND j.id <> ? AND j.status IN ('pending','processing'))`, [campaignId, jobId]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

function parsePayload(payload: string | JobPayload): JobPayload { return typeof payload === 'string' ? JSON.parse(payload) as JobPayload : payload; }
function template(jobType: JobRow['job_type']): string { return jobType.replace(/^send_/, ''); }
function toEmailMessage(jobType: JobRow['job_type'], payload: JobPayload): EmailMessage {
  if (jobType === 'send_paid_receipt') { const value = payload as ReceiptPayload; return { to: value.to, template: 'paid_receipt', orderId: value.orderId, receiptNumber: value.receiptNumber, amountMinor: value.amountMinor, currency: value.currency }; }
  if (jobType === 'send_marketing') { const value = payload as MarketingPayload; return { to: value.to, template: 'marketing', subject: value.subject, body: value.body, unsubscribeUrl: value.unsubscribeUrl }; }
  const value = payload as TokenPayload;
  return { to: value.to, token: value.token, template: jobType === 'send_verification' ? 'verification' : 'password_reset' };
}
