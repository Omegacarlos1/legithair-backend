import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { EmailProvider } from './provider.js';

interface JobRow extends RowDataPacket { id: number; job_type: 'send_verification' | 'send_password_reset'; payload: string | { to: string; token: string } }

export async function processOneEmailJob(pool: Pool, provider: EmailProvider): Promise<boolean> {
  const connection = await pool.getConnection(); let job: JobRow | undefined;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<JobRow[]>("SELECT id, job_type, payload FROM durable_jobs WHERE queue_name = 'email' AND status = 'pending' AND available_at <= NOW(3) ORDER BY id LIMIT 1 FOR UPDATE");
    job = rows[0];
    if (!job) { await connection.commit(); return false; }
    await connection.query("UPDATE durable_jobs SET status = 'processing', attempts = attempts + 1, locked_at = NOW(3), locked_by = 'local-email-worker' WHERE id = ?", [job.id]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) as { to: string; token: string } : job.payload;
  try {
    await provider.send({ to: payload.to, token: payload.token, template: job.job_type === 'send_verification' ? 'verification' : 'password_reset' });
    await pool.query("UPDATE durable_jobs SET status = 'completed', locked_at = NULL, locked_by = NULL, last_error = NULL WHERE id = ?", [job.id]); return true;
  } catch (error) {
    await pool.query("UPDATE durable_jobs SET status = 'pending', available_at = DATE_ADD(NOW(3), INTERVAL LEAST(attempts * attempts, 60) MINUTE), locked_at = NULL, locked_by = NULL, last_error = ? WHERE id = ?", [error instanceof Error ? error.message.slice(0, 1000) : 'Email provider failed', job.id]); throw error;
  }
}
