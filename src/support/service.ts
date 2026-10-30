import { createHash, randomUUID } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { AppError } from '../http/errors.js';
import type { CreateMessageInput, CreateThreadInput, MessagePage, SupportActor } from './types.js';

interface ThreadRow extends RowDataPacket {
  id: string; customer_user_id: string; subject: string; status: 'open' | 'closed'; assigned_support_user_id: string | null;
  last_message_at: Date; created_at: Date; updated_at: Date; customer_name?: string; assigned_name?: string | null;
}
interface MessageRow extends RowDataPacket {
  id: number | string; thread_id: string; sender_user_id: string; client_id: string; request_hash: string; body: string;
  created_at: Date; sender_name?: string;
}

export class SupportService {
  public constructor(private readonly pool: Pool) {}

  public async createThread(actor: SupportActor, input: CreateThreadInput): Promise<{ thread: object; message: object; idempotentReplay: boolean }> {
    if (!actor.roles.includes('customer')) throw new AppError(403, 'CUSTOMER_ROLE_REQUIRED', 'The customer role is required');
    const requestHash = hash({ kind: 'thread', subject: input.subject.trim(), body: input.message.trim() });
    const connection = await this.pool.getConnection();
    let threadId!: string;
    let message!: MessageRow;
    let replay = false;
    try {
      await connection.beginTransaction();
      const [existing] = await connection.query<MessageRow[]>('SELECT * FROM support_messages WHERE sender_user_id = ? AND client_id = ? FOR UPDATE', [actor.id, input.clientId]);
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash) throw new AppError(409, 'CLIENT_ID_REUSED', 'The client ID was already used with different support content');
        threadId = existing[0].thread_id;
        message = existing[0];
        replay = true;
      } else {
        threadId = randomUUID();
        await connection.query('INSERT INTO support_threads (id, customer_user_id, subject) VALUES (?, ?, ?)', [threadId, actor.id, input.subject.trim()]);
        const [insert] = await connection.query<ResultSetHeader>('INSERT INTO support_messages (thread_id, sender_user_id, client_id, request_hash, body) VALUES (?, ?, ?, ?, ?)', [threadId, actor.id, input.clientId, requestHash, input.message.trim()]);
        const [created] = await connection.query<MessageRow[]>('SELECT * FROM support_messages WHERE id = ?', [insert.insertId]);
        message = created[0]!;
        await this.enqueueMessageEvent(connection, threadId, message.id);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (!isDuplicateKeyError(error)) throw error;
      const [existing] = await connection.query<MessageRow[]>('SELECT * FROM support_messages WHERE sender_user_id = ? AND client_id = ?', [actor.id, input.clientId]);
      if (!existing[0]) throw error;
      if (existing[0].request_hash !== requestHash) throw new AppError(409, 'CLIENT_ID_REUSED', 'The client ID was already used with different support content');
      threadId = existing[0].thread_id;
      message = existing[0];
      replay = true;
    } finally { connection.release(); }
    return { thread: await this.getThread(actor, threadId), message: this.messageView(message), idempotentReplay: replay };
  }

  public async createMessage(actor: SupportActor, threadId: string, input: CreateMessageInput): Promise<{ message: object; idempotentReplay: boolean }> {
    const requestHash = hash({ kind: 'message', threadId, body: input.body.trim() });
    const connection = await this.pool.getConnection();
    let message!: MessageRow;
    let replay = false;
    try {
      await connection.beginTransaction();
      const [existing] = await connection.query<MessageRow[]>('SELECT * FROM support_messages WHERE sender_user_id = ? AND client_id = ? FOR UPDATE', [actor.id, input.clientId]);
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash) throw new AppError(409, 'CLIENT_ID_REUSED', 'The client ID was already used with different support content');
        message = existing[0];
        replay = true;
      } else {
        const thread = await this.lockAccessibleThread(connection, actor, threadId);
        if (thread.status !== 'open') throw new AppError(409, 'SUPPORT_THREAD_CLOSED', 'The support thread is closed');
        const [insert] = await connection.query<ResultSetHeader>('INSERT INTO support_messages (thread_id, sender_user_id, client_id, request_hash, body) VALUES (?, ?, ?, ?, ?)', [threadId, actor.id, input.clientId, requestHash, input.body.trim()]);
        await connection.query('UPDATE support_threads SET last_message_at = NOW(3) WHERE id = ?', [threadId]);
        const [created] = await connection.query<MessageRow[]>('SELECT * FROM support_messages WHERE id = ?', [insert.insertId]);
        message = created[0]!;
        await this.enqueueMessageEvent(connection, threadId, message.id);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (!isDuplicateKeyError(error)) throw error;
      const [existing] = await connection.query<MessageRow[]>('SELECT * FROM support_messages WHERE sender_user_id = ? AND client_id = ?', [actor.id, input.clientId]);
      if (!existing[0]) throw error;
      if (existing[0].request_hash !== requestHash) throw new AppError(409, 'CLIENT_ID_REUSED', 'The client ID was already used with different support content');
      message = existing[0];
      replay = true;
    } finally { connection.release(); }
    return { message: this.messageView(message), idempotentReplay: replay };
  }

  public async listThreads(actor: SupportActor, limit: number): Promise<object[]> {
    const staff = isStaff(actor);
    if (!staff && !actor.roles.includes('customer')) throw new AppError(403, 'FORBIDDEN', 'Customer, support, or admin access is required');
    const [rows] = await this.pool.query<ThreadRow[]>(`SELECT t.*, customer.display_name AS customer_name, assigned.display_name AS assigned_name
      FROM support_threads t JOIN users customer ON customer.id = t.customer_user_id
      LEFT JOIN users assigned ON assigned.id = t.assigned_support_user_id
      ${staff ? '' : 'WHERE t.customer_user_id = ?'} ORDER BY t.last_message_at DESC, t.id LIMIT ?`, staff ? [limit] : [actor.id, limit]);
    return rows.map((row) => this.threadView(row));
  }

  public async getThread(actor: SupportActor, threadId: string): Promise<object> {
    const [rows] = await this.pool.query<ThreadRow[]>(`SELECT t.*, customer.display_name AS customer_name, assigned.display_name AS assigned_name
      FROM support_threads t JOIN users customer ON customer.id = t.customer_user_id
      LEFT JOIN users assigned ON assigned.id = t.assigned_support_user_id WHERE t.id = ?`, [threadId]);
    const thread = rows[0];
    if (!thread || (!isStaff(actor) && thread.customer_user_id !== actor.id)) throw new AppError(404, 'SUPPORT_THREAD_NOT_FOUND', 'Support thread not found');
    return this.threadView(thread);
  }

  public async listMessages(actor: SupportActor, threadId: string, page: MessagePage): Promise<{ messages: object[]; nextAfterMessageId: string | null }> {
    await this.assertAccess(actor, threadId);
    const values: unknown[] = [threadId];
    const after = page.afterMessageId ? 'AND m.id > ?' : '';
    if (page.afterMessageId) values.push(page.afterMessageId);
    values.push(page.limit + 1);
    const [rows] = await this.pool.query<MessageRow[]>(`SELECT m.*, u.display_name AS sender_name FROM support_messages m JOIN users u ON u.id = m.sender_user_id
      WHERE m.thread_id = ? ${after} ORDER BY m.id LIMIT ?`, values);
    const visible = rows.slice(0, page.limit);
    return { messages: visible.map((row) => this.messageView(row)), nextAfterMessageId: rows.length > page.limit ? String(visible[visible.length - 1]!.id) : null };
  }

  public async updateThread(actor: SupportActor, threadId: string, input: { status?: 'open' | 'closed'; assignedSupportUserId?: string | null }): Promise<object> {
    if (!isStaff(actor)) throw new AppError(403, 'FORBIDDEN', 'Support or admin access is required');
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await this.lockAccessibleThread(connection, actor, threadId);
      if (input.assignedSupportUserId) {
        const [roles] = await connection.query<RowDataPacket[]>("SELECT 1 FROM user_roles WHERE user_id = ? AND role IN ('support','admin') LIMIT 1", [input.assignedSupportUserId]);
        if (!roles[0]) throw new AppError(400, 'INVALID_SUPPORT_ASSIGNEE', 'Assignee must have the support or admin role');
      }
      const fields: string[] = [];
      const values: unknown[] = [];
      if (input.status !== undefined) { fields.push('status = ?'); values.push(input.status); }
      if (input.assignedSupportUserId !== undefined) { fields.push('assigned_support_user_id = ?'); values.push(input.assignedSupportUserId); }
      await connection.query(`UPDATE support_threads SET ${fields.join(', ')} WHERE id = ?`, [...values, threadId]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return this.getThread(actor, threadId);
  }

  private async assertAccess(actor: SupportActor, threadId: string): Promise<void> {
    const [rows] = await this.pool.query<ThreadRow[]>('SELECT * FROM support_threads WHERE id = ?', [threadId]);
    const thread = rows[0];
    if (!thread || (!isStaff(actor) && thread.customer_user_id !== actor.id)) throw new AppError(404, 'SUPPORT_THREAD_NOT_FOUND', 'Support thread not found');
  }

  private async lockAccessibleThread(connection: import('mysql2/promise').PoolConnection, actor: SupportActor, threadId: string): Promise<ThreadRow> {
    const [rows] = await connection.query<ThreadRow[]>('SELECT * FROM support_threads WHERE id = ? FOR UPDATE', [threadId]);
    const thread = rows[0];
    if (!thread || (!isStaff(actor) && thread.customer_user_id !== actor.id)) throw new AppError(404, 'SUPPORT_THREAD_NOT_FOUND', 'Support thread not found');
    return thread;
  }

  private async enqueueMessageEvent(connection: import('mysql2/promise').PoolConnection, threadId: string, messageId: number | string): Promise<void> {
    await connection.query("INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('support_thread', ?, 'support.message.created', ?)", [threadId, JSON.stringify({ threadId, messageId: String(messageId) })]);
  }

  private threadView(row: ThreadRow): object {
    return { id: row.id, customerUserId: row.customer_user_id, customerName: row.customer_name, subject: row.subject, status: row.status, assignedSupportUserId: row.assigned_support_user_id, assignedSupportName: row.assigned_name ?? null, lastMessageAt: row.last_message_at, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private messageView(row: MessageRow): object {
    return { id: String(row.id), threadId: row.thread_id, senderUserId: row.sender_user_id, senderName: row.sender_name, clientId: row.client_id, body: row.body, createdAt: row.created_at };
  }
}

function isStaff(actor: SupportActor): boolean { return actor.roles.includes('support') || actor.roles.includes('admin'); }
function hash(value: object): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY';
}
