import assert from 'node:assert/strict';
import { createServer, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import pino from 'pino';
import request from 'supertest';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDatabasePool } from '../../src/database/pool.js';
import { migrate } from '../../src/database/migrate.js';
import { createSupportSocketRuntime, type SupportSocketRuntime } from '../../src/support/socket.js';

interface CountRow extends RowDataPacket { total: number | string }
interface EventRow extends RowDataPacket { id: number }
interface SocketAck { ok: boolean; data?: { idempotentReplay?: boolean; message?: { id: string }; messages?: Array<{ id: string }> }; error?: { code: string } }
interface SupportEvent { message: { clientId: string } }

describe('B11 Socket.IO support delivery against MariaDB', function () {
  this.timeout(40_000);
  let pool: Pool;
  let server: HttpServer;
  let runtime: SupportSocketRuntime;
  let url: string;
  let api: ReturnType<typeof request>;
  let customerToken: string;
  let otherToken: string;
  let supportToken: string;
  const clients: ClientSocket[] = [];
  const password = 'ValidPass123!';
  const customerId = 'b1200000-0000-4000-8000-000000000001';
  const otherId = 'b1200000-0000-4000-8000-000000000002';
  const supportId = 'b1200000-0000-4000-8000-000000000003';

  before(async () => {
    process.env.EMAIL_PROVIDER = 'fake';
    const config = loadConfig();
    assert.equal(config.NODE_ENV, 'test'); assert.match(config.DATABASE_NAME, /_test$/);
    await migrate('down'); await migrate('up');
    pool = createDatabasePool(config);
    const app = createApp({ pool, logger: pino({ level: 'silent' }), readinessTimeoutMs: 100 });
    api = request(app);
    server = createServer(app);
    runtime = createSupportSocketRuntime(server, pool, pino({ level: 'silent' }), { lockTimeoutSeconds: 5, pollMilliseconds: 10_000 });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Socket test server did not bind');
    url = `http://127.0.0.1:${address.port}`;
    const hash = await argon2.hash(password);
    for (const fixture of [
      [customerId, 'socket.customer@example.test', 'Socket Customer', 'customer'],
      [otherId, 'socket.other@example.test', 'Socket Other', 'customer'],
      [supportId, 'socket.support@example.test', 'Socket Support', 'support']
    ] as const) {
      await pool.query('INSERT INTO users (id, email, password_hash, display_name, email_verified_at) VALUES (?, ?, ?, ?, NOW(3))', [fixture[0], fixture[1], hash, fixture[2]]);
      await pool.query('INSERT INTO user_roles (user_id, role) VALUES (?, ?)', [fixture[0], fixture[3]]);
    }
    customerToken = await login('socket.customer@example.test');
    otherToken = await login('socket.other@example.test');
    supportToken = await login('socket.support@example.test');
  });

  after(async () => {
    for (const client of clients) client.disconnect();
    if (runtime) await runtime.close();
    if (pool) await pool.end();
  });

  async function login(email: string): Promise<string> {
    const response = await api.post('/api/v1/auth/login').send({ email, password }).expect(200);
    return response.body.data.tokens.accessToken as string;
  }

  async function connect(token: string): Promise<ClientSocket> {
    const client = createClient(url, { auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(client);
    await new Promise<void>((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
    return client;
  }

  function emitAck(client: ClientSocket, event: string, payload: object): Promise<SocketAck> {
    return new Promise((resolve) => client.emit(event, payload, resolve));
  }

  function waitForSupportMessage(client: ClientSocket, clientId: string): Promise<SupportEvent> {
    return new Promise((resolve) => {
      const listener = (event: SupportEvent): void => {
        if (event.message.clientId !== clientId) return;
        client.off('support:message', listener);
        resolve(event);
      };
      client.on('support:message', listener);
    });
  }

  it('rejects an unauthenticated Socket.IO connection', async () => {
    const client = createClient(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(client);
    const error = await new Promise<Error & { data?: { code?: string } }>((resolve) => client.once('connect_error', resolve));
    assert.equal(error.data?.code, 'UNAUTHENTICATED');
  });

  it('enforces room ownership, acknowledges retries once, and returns missed history after reconnect', async () => {
    const initialClientId = randomUUID();
    const created = await api.post('/api/v1/support/threads').set('authorization', `Bearer ${customerToken}`)
      .send({ subject: 'Synthetic socket help', message: 'Initial persistent support message', clientId: initialClientId }).expect(201);
    const threadId = created.body.data.thread.id as string;
    const customer = await connect(customerToken);
    const other = await connect(otherToken);
    const support = await connect(supportToken);

    const denied = await emitAck(other, 'support:join', { threadId });
    assert.equal(denied.ok, false); assert.equal(denied.error?.code, 'SUPPORT_THREAD_NOT_FOUND');
    await api.get(`/api/v1/support/threads/${threadId}/messages`).set('authorization', `Bearer ${otherToken}`).expect(404);

    const customerJoin = await emitAck(customer, 'support:join', { threadId });
    const supportJoin = await emitAck(support, 'support:join', { threadId });
    assert.equal(customerJoin.ok, true); assert.equal(supportJoin.ok, true);

    const clientId = randomUUID();
    const delivered = waitForSupportMessage(support, clientId);
    const acknowledgement = await emitAck(customer, 'support:message', { threadId, clientId, body: 'Persist this before realtime delivery.' });
    assert.equal(acknowledgement.ok, true); assert.equal(acknowledgement.data?.idempotentReplay, false);
    const event = await delivered;
    assert.equal(event.message.clientId, clientId);
    const firstOffset = acknowledgement.data!.message!.id;

    const replay = await emitAck(customer, 'support:message', { threadId, clientId, body: 'Persist this before realtime delivery.' });
    assert.equal(replay.ok, true); assert.equal(replay.data?.idempotentReplay, true);
    const [deduplicated] = await pool.query<CountRow[]>('SELECT COUNT(*) AS total FROM support_messages WHERE sender_user_id = ? AND client_id = ?', [customerId, clientId]);
    assert.equal(Number(deduplicated[0]!.total), 1);

    const concurrentClientId = randomUUID();
    const concurrentBody = { clientId: concurrentClientId, body: 'A concurrent retry must create one logical message.' };
    const concurrentResponses = await Promise.all([
      api.post(`/api/v1/support/threads/${threadId}/messages`).set('authorization', `Bearer ${customerToken}`).send(concurrentBody),
      api.post(`/api/v1/support/threads/${threadId}/messages`).set('authorization', `Bearer ${customerToken}`).send(concurrentBody)
    ]);
    assert.deepEqual(concurrentResponses.map((response) => response.status).sort(), [200, 201]);
    const [concurrentCount] = await pool.query<CountRow[]>('SELECT COUNT(*) AS total FROM support_messages WHERE sender_user_id = ? AND client_id = ?', [customerId, concurrentClientId]);
    assert.equal(Number(concurrentCount[0]!.total), 1);

    support.disconnect();
    const missedClientId = randomUUID();
    const missed = await api.post(`/api/v1/support/threads/${threadId}/messages`).set('authorization', `Bearer ${customerToken}`)
      .send({ clientId: missedClientId, body: 'This message is sent while support is disconnected.' }).expect(201);
    await runtime.publisher.publishAvailable();
    const reconnectedSupport = await connect(supportToken);
    const recovered = await emitAck(reconnectedSupport, 'support:join', { threadId, afterMessageId: firstOffset });
    assert.equal(recovered.ok, true);
    assert.ok(recovered.data!.messages!.some((message) => message.id === missed.body.data.message.id));

    const crashClientId = randomUUID();
    const crashMessage = await api.post(`/api/v1/support/threads/${threadId}/messages`).set('authorization', `Bearer ${customerToken}`)
      .send({ clientId: crashClientId, body: 'Recover this event from a stale outbox worker lease.' }).expect(201);
    const [events] = await pool.query<EventRow[]>("SELECT id FROM outbox_events WHERE event_type = 'support.message.created' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.messageId')) = ?", [crashMessage.body.data.message.id]);
    await pool.query("UPDATE outbox_events SET locked_at = DATE_SUB(NOW(3), INTERVAL 60 SECOND), locked_by = 'crashed-worker' WHERE id = ?", [events[0]!.id]);
    assert.equal(await runtime.publisher.publishOne(), true);
    const [published] = await pool.query<CountRow[]>('SELECT COUNT(*) AS total FROM outbox_events WHERE id = ? AND published_at IS NOT NULL', [events[0]!.id]);
    assert.equal(Number(published[0]!.total), 1);
  });
});
