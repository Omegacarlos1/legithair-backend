import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Logger } from 'pino';

interface OutboxRow extends RowDataPacket { id: number | string; aggregate_id: string; payload: string | { threadId: string; messageId: string } }
interface MessageRow extends RowDataPacket { id: number | string; thread_id: string; sender_user_id: string; client_id: string; body: string; created_at: Date; sender_name: string }
export interface SupportEventEmitter { emitToThread(threadId: string, event: { eventId: string; message: object }): void }

export class SupportOutboxPublisher {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  public constructor(private readonly pool: Pool, private readonly emitter: SupportEventEmitter, private readonly logger: Logger, private readonly lockTimeoutSeconds = 30) {}

  public start(pollMilliseconds: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.flush(); }, pollMilliseconds);
    this.timer.unref();
    void this.flush();
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  public async publishAvailable(limit = 100): Promise<number> {
    let published = 0;
    while (published < limit && await this.publishOne()) published += 1;
    return published;
  }

  public async publishOne(): Promise<boolean> {
    const workerId = `support-outbox-${process.pid}`;
    const connection = await this.pool.getConnection();
    let event: OutboxRow | undefined;
    try {
      await connection.beginTransaction();
      await connection.query(`UPDATE outbox_events SET locked_at = NULL, locked_by = NULL
        WHERE event_type = 'support.message.created' AND published_at IS NULL AND locked_at < DATE_SUB(NOW(3), INTERVAL ? SECOND)`, [this.lockTimeoutSeconds]);
      const [events] = await connection.query<OutboxRow[]>(`SELECT id, aggregate_id, payload FROM outbox_events
        WHERE event_type = 'support.message.created' AND published_at IS NULL AND available_at <= NOW(3) AND locked_at IS NULL
        ORDER BY id LIMIT 1 FOR UPDATE`, []);
      event = events[0];
      if (!event) { await connection.commit(); return false; }
      await connection.query('UPDATE outbox_events SET locked_at = NOW(3), locked_by = ? WHERE id = ?', [workerId, event.id]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }

    try {
      const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) as { threadId: string; messageId: string } : event.payload;
      const [messages] = await this.pool.query<MessageRow[]>(`SELECT m.*, u.display_name AS sender_name FROM support_messages m JOIN users u ON u.id = m.sender_user_id
        WHERE m.id = ? AND m.thread_id = ?`, [payload.messageId, payload.threadId]);
      const message = messages[0];
      if (!message) throw new Error('Persisted support message is missing');
      this.emitter.emitToThread(payload.threadId, { eventId: String(event.id), message: messageView(message) });
      await this.pool.query('UPDATE outbox_events SET published_at = NOW(3), locked_at = NULL, locked_by = NULL, attempts = attempts + 1, last_error = NULL WHERE id = ?', [event.id]);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : 'Support outbox publication failed';
      await this.pool.query(`UPDATE outbox_events SET locked_at = NULL, locked_by = NULL, attempts = attempts + 1, last_error = ?,
        available_at = DATE_ADD(NOW(3), INTERVAL LEAST(attempts + 1, 60) SECOND) WHERE id = ?`, [message, event.id]);
      throw error;
    }
  }

  private async flush(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { await this.publishAvailable(); } catch (error) { this.logger.error({ err: error }, 'Support outbox publication failed'); } finally { this.running = false; }
  }
}

function messageView(row: MessageRow): object {
  return { id: String(row.id), threadId: row.thread_id, senderUserId: row.sender_user_id, senderName: row.sender_name, clientId: row.client_id, body: row.body, createdAt: row.created_at };
}
