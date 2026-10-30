import assert from 'node:assert/strict';
import argon2 from 'argon2';
import pino from 'pino';
import request from 'supertest';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDatabasePool } from '../../src/database/pool.js';
import { migrate } from '../../src/database/migrate.js';
import { processOneEmailJob } from '../../src/email/job-processor.js';
import { FakeEmailProvider } from '../../src/email/provider.js';

interface JobRow extends RowDataPacket { id: number; payload: string | { unsubscribeUrl: string }; status: string; attempts: number; deduplication_key: string }
interface CountRow extends RowDataPacket { total: number | string }
interface DeliveryRow extends RowDataPacket { status: string; attempts: number }

describe('B11 marketing consent, suppression, unsubscribe, and email recovery against MariaDB', function () {
  this.timeout(40_000);
  let pool: Pool;
  let api: ReturnType<typeof request>;
  let customerToken: string;
  let otherCustomerToken: string;
  let adminToken: string;
  const password = 'ValidPass123!';
  const customerId = 'b1100000-0000-4000-8000-000000000001';
  const otherCustomerId = 'b1100000-0000-4000-8000-000000000002';
  const adminId = 'b1100000-0000-4000-8000-000000000003';

  before(async () => {
    process.env.EMAIL_PROVIDER = 'fake';
    const config = loadConfig();
    assert.equal(config.NODE_ENV, 'test'); assert.match(config.DATABASE_NAME, /_test$/);
    await migrate('down'); await migrate('up');
    pool = createDatabasePool(config);
    api = request(createApp({ pool, logger: pino({ level: 'silent' }), readinessTimeoutMs: 100, marketingUnsubscribeBaseUrl: 'http://127.0.0.1:3000/api/v1/marketing/unsubscribe' }));
    const hash = await argon2.hash(password);
    for (const fixture of [
      [customerId, 'b11.customer@example.test', 'B11 Customer', 'customer'],
      [otherCustomerId, 'b11.other@example.test', 'B11 Other', 'customer'],
      [adminId, 'b11.admin@example.test', 'B11 Admin', 'admin']
    ] as const) {
      await pool.query('INSERT INTO users (id, email, password_hash, display_name, email_verified_at) VALUES (?, ?, ?, ?, NOW(3))', [fixture[0], fixture[1], hash, fixture[2]]);
      await pool.query('INSERT INTO user_roles (user_id, role) VALUES (?, ?)', [fixture[0], fixture[3]]);
    }
    customerToken = await login('b11.customer@example.test');
    otherCustomerToken = await login('b11.other@example.test');
    adminToken = await login('b11.admin@example.test');
  });
  after(async () => { if (pool) await pool.end(); });

  async function login(email: string): Promise<string> {
    const response = await api.post('/api/v1/auth/login').send({ email, password }).expect(200);
    return response.body.data.tokens.accessToken as string;
  }

  async function latestMarketingJob(): Promise<JobRow> {
    const [rows] = await pool.query<JobRow[]>("SELECT id, payload, status, attempts, deduplication_key FROM durable_jobs WHERE job_type = 'send_marketing' ORDER BY id DESC LIMIT 1");
    return rows[0]!;
  }

  it('queues marketing only for explicit unsuppressed consent and supports idempotent unsubscribe', async () => {
    const initial = await api.get('/api/v1/me/marketing-preference').set('authorization', `Bearer ${customerToken}`).expect(200);
    assert.equal(initial.body.data.preference.optedIn, false);
    await api.put('/api/v1/me/marketing-preference').set('authorization', `Bearer ${customerToken}`).send({ optedIn: true }).expect(200);
    await api.put('/api/v1/me/marketing-preference').set('authorization', `Bearer ${otherCustomerToken}`).send({ optedIn: true }).expect(200);
    await api.put('/api/v1/admin/marketing/suppressions').set('authorization', `Bearer ${adminToken}`).send({ email: 'b11.other@example.test', suppressed: true, reason: 'manual' }).expect(200);

    const campaign = await api.post('/api/v1/admin/marketing/campaigns').set('authorization', `Bearer ${adminToken}`)
      .send({ subject: 'Synthetic B11 offer', body: 'This is an explicitly opted-in synthetic marketing message.' }).expect(201);
    assert.equal(campaign.body.data.queuedRecipients, 1);
    const job = await latestMarketingJob();
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) as { unsubscribeUrl: string } : job.payload;
    const provider = new FakeEmailProvider();
    assert.equal(await processOneEmailJob(pool, provider, 5), true);
    assert.equal(provider.deliveries.length, 1);
    assert.equal(provider.deliveries[0]!.template, 'marketing');

    const unsubscribeUrl = new URL(payload.unsubscribeUrl);
    const token = unsubscribeUrl.searchParams.get('token');
    assert.ok(token);
    await api.get('/api/v1/marketing/unsubscribe').query({ token }).expect(200);
    await api.post('/api/v1/marketing/unsubscribe').send({ token }).expect(200);
    const preference = await api.get('/api/v1/me/marketing-preference').set('authorization', `Bearer ${customerToken}`).expect(200);
    assert.equal(preference.body.data.preference.optedIn, false);
    assert.equal(preference.body.data.preference.suppressionReason, 'unsubscribe');
    const noRecipients = await api.post('/api/v1/admin/marketing/campaigns').set('authorization', `Bearer ${adminToken}`)
      .send({ subject: 'No eligible recipients', body: 'This message must not be queued for suppressed users.' }).expect(201);
    assert.equal(noRecipients.body.data.queuedRecipients, 0);
  });

  it('retries one logical email job and recovers an abandoned processing lease', async () => {
    await api.put('/api/v1/me/marketing-preference').set('authorization', `Bearer ${customerToken}`).send({ optedIn: true }).expect(200);
    const campaign = await api.post('/api/v1/admin/marketing/campaigns').set('authorization', `Bearer ${adminToken}`)
      .send({ subject: 'Retry fixture', body: 'This synthetic campaign verifies durable retry behavior.' }).expect(201);
    assert.equal(campaign.body.data.queuedRecipients, 1);
    const job = await latestMarketingJob();
    await assert.rejects(processOneEmailJob(pool, { send: async () => { throw new Error('synthetic provider outage'); } }, 5), /synthetic provider outage/);
    await pool.query('UPDATE durable_jobs SET available_at = NOW(3) WHERE id = ?', [job.id]);
    const provider = new FakeEmailProvider();
    assert.equal(await processOneEmailJob(pool, provider, 5), true);
    assert.equal(provider.deliveries.length, 1);
    const [counts] = await pool.query<CountRow[]>('SELECT COUNT(*) AS total FROM durable_jobs WHERE deduplication_key = ?', [job.deduplication_key]);
    assert.equal(Number(counts[0]!.total), 1);
    const [deliveries] = await pool.query<DeliveryRow[]>('SELECT status, attempts FROM email_deliveries WHERE durable_job_id = ?', [job.id]);
    assert.equal(deliveries[0]!.status, 'sent'); assert.equal(deliveries[0]!.attempts, 2);
    const [attempts] = await pool.query<CountRow[]>('SELECT COUNT(*) AS total FROM email_delivery_attempts WHERE delivery_id = (SELECT id FROM email_deliveries WHERE durable_job_id = ?)', [job.id]);
    assert.equal(Number(attempts[0]!.total), 2);

    const crashCampaign = await api.post('/api/v1/admin/marketing/campaigns').set('authorization', `Bearer ${adminToken}`)
      .send({ subject: 'Worker crash fixture', body: 'This campaign verifies recovery from an abandoned lease.' }).expect(201);
    assert.equal(crashCampaign.body.data.queuedRecipients, 1);
    const abandoned = await latestMarketingJob();
    await pool.query("UPDATE durable_jobs SET status = 'processing', locked_at = DATE_SUB(NOW(3), INTERVAL 60 SECOND), locked_by = 'crashed-worker' WHERE id = ?", [abandoned.id]);
    const recovered = new FakeEmailProvider();
    assert.equal(await processOneEmailJob(pool, recovered, 5), true);
    assert.equal(recovered.deliveries.length, 1);
  });

  it('rechecks suppression after queueing and never calls the provider for that recipient', async () => {
    await api.put('/api/v1/me/marketing-preference').set('authorization', `Bearer ${customerToken}`).send({ optedIn: false }).expect(200);
    await api.put('/api/v1/admin/marketing/suppressions').set('authorization', `Bearer ${adminToken}`).send({ email: 'b11.other@example.test', suppressed: false }).expect(200);
    await api.put('/api/v1/me/marketing-preference').set('authorization', `Bearer ${otherCustomerToken}`).send({ optedIn: true }).expect(200);
    const campaign = await api.post('/api/v1/admin/marketing/campaigns').set('authorization', `Bearer ${adminToken}`)
      .send({ subject: 'Suppression race fixture', body: 'This queued message must be suppressed before provider delivery.' }).expect(201);
    assert.equal(campaign.body.data.queuedRecipients, 1);
    const job = await latestMarketingJob();
    await api.put('/api/v1/admin/marketing/suppressions').set('authorization', `Bearer ${adminToken}`).send({ email: 'b11.other@example.test', suppressed: true, reason: 'complaint' }).expect(200);
    const provider = new FakeEmailProvider();
    assert.equal(await processOneEmailJob(pool, provider, 5), true);
    assert.equal(provider.deliveries.length, 0);
    const [deliveries] = await pool.query<DeliveryRow[]>('SELECT status, attempts FROM email_deliveries WHERE durable_job_id = ?', [job.id]);
    assert.equal(deliveries[0]!.status, 'suppressed');
    await api.put('/api/v1/me/marketing-preference').set('authorization', `Bearer ${otherCustomerToken}`).send({ optedIn: false }).expect(200);
    const reOptIn = await api.put('/api/v1/me/marketing-preference').set('authorization', `Bearer ${otherCustomerToken}`).send({ optedIn: true }).expect(200);
    assert.equal(reOptIn.body.data.preference.suppressed, true);
    assert.equal(reOptIn.body.data.preference.suppressionReason, 'complaint');
  });
});
