import { randomUUID } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { createOpaqueToken, hashToken } from '../auth/token.js';
import { AppError } from '../http/errors.js';

interface PreferenceRow extends RowDataPacket { user_id: string; opted_in_at: Date | null; opted_out_at: Date | null; source: string | null; email: string; suppression_reason: string | null }
interface RecipientRow extends RowDataPacket { id: string; email: string }
interface TokenRow extends RowDataPacket { id: string; user_id: string; used_at: Date | null; email: string }
interface DeliveryRow extends RowDataPacket { id: string; recipient_email: string; status: string; attempts: number; last_error: string | null; sent_at: Date | null; created_at: Date }

export class MarketingService {
  public constructor(private readonly pool: Pool, private readonly unsubscribeBaseUrl?: string) {}

  public async getPreference(userId: string): Promise<object> {
    const [rows] = await this.pool.query<PreferenceRow[]>(`SELECT u.id AS user_id, p.opted_in_at, p.opted_out_at, p.source, u.email,
      (SELECT reason FROM email_suppressions s WHERE s.email = u.email AND s.lifted_at IS NULL) AS suppression_reason
      FROM users u LEFT JOIN marketing_preferences p ON p.user_id = u.id WHERE u.id = ?`, [userId]);
    const row = rows[0];
    if (!row) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    return preferenceView(row);
  }

  public async setPreference(userId: string, optedIn: boolean): Promise<object> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [users] = await connection.query<Array<RowDataPacket & { email: string }>>('SELECT email FROM users WHERE id = ? FOR UPDATE', [userId]);
      const email = users[0]?.email;
      if (!email) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
      if (optedIn) {
        await connection.query(`INSERT INTO marketing_preferences (user_id, opted_in_at, opted_out_at, source) VALUES (?, NOW(3), NULL, 'account_settings')
          ON DUPLICATE KEY UPDATE opted_in_at = NOW(3), opted_out_at = NULL, source = 'account_settings'`, [userId]);
        await connection.query("UPDATE email_suppressions SET lifted_at = NOW(3) WHERE email = ? AND reason = 'unsubscribe' AND lifted_at IS NULL", [email]);
      } else {
        await connection.query(`INSERT INTO marketing_preferences (user_id, opted_in_at, opted_out_at, source) VALUES (?, NULL, NOW(3), 'account_settings')
          ON DUPLICATE KEY UPDATE opted_out_at = NOW(3), source = 'account_settings'`, [userId]);
        await connection.query(`INSERT INTO email_suppressions (email, reason, actor_user_id) VALUES (?, 'unsubscribe', ?)
          ON DUPLICATE KEY UPDATE
            reason = IF(lifted_at IS NULL AND reason IN ('bounce','complaint','manual'), reason, 'unsubscribe'),
            actor_user_id = IF(lifted_at IS NULL AND reason IN ('bounce','complaint','manual'), actor_user_id, VALUES(actor_user_id)),
            suppressed_at = IF(lifted_at IS NULL AND reason IN ('bounce','complaint','manual'), suppressed_at, NOW(3)),
            lifted_at = NULL`, [email, userId]);
      }
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return this.getPreference(userId);
  }

  public async setSuppression(actorUserId: string, input: { email: string; suppressed: boolean; reason?: 'bounce' | 'complaint' | 'manual' }): Promise<object> {
    const email = input.email.trim().toLowerCase();
    if (input.suppressed) {
      await this.pool.query(`INSERT INTO email_suppressions (email, reason, actor_user_id) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE reason = VALUES(reason), actor_user_id = VALUES(actor_user_id), suppressed_at = NOW(3), lifted_at = NULL`, [email, input.reason ?? 'manual', actorUserId]);
    } else {
      await this.pool.query('UPDATE email_suppressions SET lifted_at = NOW(3), actor_user_id = ? WHERE email = ? AND lifted_at IS NULL', [actorUserId, email]);
    }
    const [rows] = await this.pool.query<RowDataPacket[]>('SELECT email, reason, suppressed_at AS suppressedAt, lifted_at AS liftedAt FROM email_suppressions WHERE email = ?', [email]);
    return rows[0] ?? { email, reason: null, suppressedAt: null, liftedAt: null };
  }

  public async createCampaign(actorUserId: string, input: { subject: string; body: string }): Promise<{ campaign: object; queuedRecipients: number }> {
    if (!this.unsubscribeBaseUrl) throw new AppError(503, 'MARKETING_UNSUBSCRIBE_URL_UNCONFIGURED', 'Marketing unsubscribe URL is not configured');
    const campaignId = randomUUID();
    const connection = await this.pool.getConnection();
    let recipientCount: number;
    try {
      await connection.beginTransaction();
      await connection.query("INSERT INTO marketing_campaigns (id, subject, body, created_by) VALUES (?, ?, ?, ?)", [campaignId, input.subject.trim(), input.body.trim(), actorUserId]);
      const [recipients] = await connection.query<RecipientRow[]>(`SELECT u.id, u.email FROM users u JOIN marketing_preferences p ON p.user_id = u.id
        LEFT JOIN email_suppressions s ON s.email = u.email AND s.lifted_at IS NULL
        WHERE p.opted_in_at IS NOT NULL AND p.opted_out_at IS NULL AND s.email IS NULL ORDER BY u.id FOR UPDATE`);
      for (const recipient of recipients) {
        const token = createOpaqueToken();
        await connection.query('INSERT INTO marketing_unsubscribe_tokens (id, token_hash, user_id, campaign_id) VALUES (?, ?, ?, ?)', [token.id, token.hash, recipient.id, campaignId]);
        const logicalKey = `marketing:${campaignId}:${recipient.id}`;
        const payload = { to: recipient.email, userId: recipient.id, campaignId, subject: input.subject.trim(), body: input.body.trim(), unsubscribeUrl: appendToken(this.unsubscribeBaseUrl, token.raw) };
        const [job] = await connection.query<ResultSetHeader>(`INSERT INTO durable_jobs (queue_name, job_type, deduplication_key, payload)
          VALUES ('email', 'send_marketing', ?, ?)`, [logicalKey, JSON.stringify(payload)]);
        await connection.query(`INSERT INTO email_deliveries (id, durable_job_id, user_id, category, template, recipient_email, logical_key)
          VALUES (?, ?, ?, 'marketing', 'marketing', ?, ?)`, [randomUUID(), job.insertId, recipient.id, recipient.email, logicalKey]);
      }
      recipientCount = recipients.length;
      await connection.query("UPDATE marketing_campaigns SET recipient_count = ?, status = ?, completed_at = IF(? = 0, NOW(3), NULL) WHERE id = ?", [recipientCount, recipientCount === 0 ? 'completed' : 'queued', recipientCount, campaignId]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return { campaign: { id: campaignId, subject: input.subject.trim(), body: input.body.trim(), status: recipientCount === 0 ? 'completed' : 'queued', recipientCount }, queuedRecipients: recipientCount };
  }

  public async unsubscribe(rawToken: string): Promise<object> {
    const connection = await this.pool.getConnection();
    let userId: string;
    try {
      await connection.beginTransaction();
      const [tokens] = await connection.query<TokenRow[]>(`SELECT t.*, u.email FROM marketing_unsubscribe_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ? FOR UPDATE`, [hashToken(rawToken)]);
      const token = tokens[0];
      if (!token) throw new AppError(400, 'UNSUBSCRIBE_TOKEN_INVALID', 'Unsubscribe token is invalid');
      userId = token.user_id;
      await connection.query('UPDATE marketing_unsubscribe_tokens SET used_at = COALESCE(used_at, NOW(3)) WHERE id = ?', [token.id]);
      await connection.query(`INSERT INTO marketing_preferences (user_id, opted_in_at, opted_out_at, source) VALUES (?, NULL, NOW(3), 'email_unsubscribe')
        ON DUPLICATE KEY UPDATE opted_out_at = NOW(3), source = 'email_unsubscribe'`, [userId]);
      await connection.query(`INSERT INTO email_suppressions (email, reason) VALUES (?, 'unsubscribe')
        ON DUPLICATE KEY UPDATE
          reason = IF(lifted_at IS NULL AND reason IN ('bounce','complaint','manual'), reason, 'unsubscribe'),
          actor_user_id = IF(lifted_at IS NULL AND reason IN ('bounce','complaint','manual'), actor_user_id, NULL),
          suppressed_at = IF(lifted_at IS NULL AND reason IN ('bounce','complaint','manual'), suppressed_at, NOW(3)),
          lifted_at = NULL`, [token.email]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return { unsubscribed: true, userId };
  }

  public async listCampaignDeliveries(campaignId: string): Promise<object[]> {
    const [rows] = await this.pool.query<DeliveryRow[]>(`SELECT d.* FROM email_deliveries d JOIN durable_jobs j ON j.id = d.durable_job_id
      WHERE JSON_UNQUOTE(JSON_EXTRACT(j.payload, '$.campaignId')) = ? ORDER BY d.created_at, d.id`, [campaignId]);
    return rows.map((row) => ({ id: row.id, recipientEmail: row.recipient_email, status: row.status, attempts: row.attempts, lastError: row.last_error, sentAt: row.sent_at, createdAt: row.created_at }));
  }
}

function preferenceView(row: PreferenceRow): object {
  return { userId: row.user_id, optedIn: Boolean(row.opted_in_at && !row.opted_out_at), optedInAt: row.opted_in_at, optedOutAt: row.opted_out_at, source: row.source ?? null, suppressed: Boolean(row.suppression_reason), suppressionReason: row.suppression_reason };
}
function appendToken(baseUrl: string, token: string): string { const separator = baseUrl.includes('?') ? '&' : '?'; return `${baseUrl}${separator}token=${encodeURIComponent(token)}`; }
