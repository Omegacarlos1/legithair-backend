import assert from 'node:assert/strict';
import request from 'supertest';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import pino from 'pino';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDatabasePool } from '../../src/database/pool.js';
import { migrate } from '../../src/database/migrate.js';

interface JobRow extends RowDataPacket { payload: string | { token: string } }
interface AuditRow extends RowDataPacket { action: string; previous_status: string | null; new_status: string | null; reason: string | null; metadata: string | object }

describe('seller onboarding and approval against MariaDB', function () {
  this.timeout(15_000);
  let pool: Pool;
  let api: ReturnType<typeof request>;
  let ownerToken: string;
  let adminToken: string;
  let racerToken: string;
  let ownerSellerId: string;
  let adminSellerId: string;
  const password = 'ValidPass123!';

  before(async () => {
    process.env.EMAIL_PROVIDER = 'fake';
    const config = loadConfig();
    assert.equal(config.NODE_ENV, 'test');
    assert.match(config.DATABASE_NAME, /_test$/);
    await migrate('down');
    await migrate('up');
    pool = createDatabasePool(config);
    api = request(createApp({ pool, logger: pino({ level: 'silent' }), readinessTimeoutMs: 100 }));
    ownerToken = await registerVerifyAndLogin('seller.owner@example.test', 'Seller Owner');
    adminToken = await registerVerifyAndLogin('seller.admin@example.test', 'Seller Admin', true);
    racerToken = await registerVerifyAndLogin('seller.racer@example.test', 'Seller Racer');
  });

  after(async () => { if (pool) await pool.end(); });

  async function latestVerificationToken(userId: string): Promise<string> {
    const [rows] = await pool.query<JobRow[]>('SELECT payload FROM durable_jobs WHERE job_type = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload, \'$.userId\')) = ? ORDER BY id DESC LIMIT 1', ['send_verification', userId]);
    const payload = typeof rows[0]!.payload === 'string' ? JSON.parse(rows[0]!.payload) as { token: string } : rows[0]!.payload;
    return payload.token;
  }

  async function registerVerifyAndLogin(email: string, displayName: string, admin = false): Promise<string> {
    const registration = await api.post('/api/v1/auth/register').send({ email, password, displayName }).expect(201);
    const userId = registration.body.data.userId as string;
    await api.post('/api/v1/auth/verify-email').send({ token: await latestVerificationToken(userId) }).expect(200);
    if (admin) await pool.query("INSERT INTO user_roles (user_id, role) VALUES (?, 'admin')", [userId]);
    const login = await api.post('/api/v1/auth/login').send({ email, password }).expect(200);
    return login.body.data.tokens.accessToken as string;
  }

  it('creates one seller profile and returns its separate states', async () => {
    const created = await api.post('/api/v1/sellers').set('authorization', `Bearer ${ownerToken}`).send({ businessName: 'Synthetic Hair Store', phone: '+2348000000000' }).expect(201);
    ownerSellerId = created.body.data.seller.id as string;
    assert.equal(created.body.data.seller.identityStatus, 'not_started');
    assert.equal(created.body.data.seller.approvalStatus, 'pending');
    await api.post('/api/v1/sellers').set('authorization', `Bearer ${ownerToken}`).send({ businessName: 'Duplicate Store', phone: '+2348000000001' }).expect(409);
    const own = await api.get('/api/v1/sellers/me').set('authorization', `Bearer ${ownerToken}`).expect(200);
    assert.equal(own.body.data.seller.id, ownerSellerId);
  });

  it('enforces the one-profile invariant under a concurrent create race', async () => {
    const attempts = await Promise.all([
      api.post('/api/v1/sellers').set('authorization', `Bearer ${racerToken}`).send({ businessName: 'Race Store One', phone: '+2348000000002' }),
      api.post('/api/v1/sellers').set('authorization', `Bearer ${racerToken}`).send({ businessName: 'Race Store Two', phone: '+2348000000003' })
    ]);
    assert.deepEqual(attempts.map((response) => response.status).sort(), [201, 409]);
  });

  it('fails verification safely while Dojah and consent are deferred', async () => {
    const unavailable = await api.post('/api/v1/sellers/me/verification').set('authorization', `Bearer ${ownerToken}`).send({}).expect(503);
    assert.equal(unavailable.body.error.code, 'IDENTITY_PROVIDER_NOT_CONFIGURED');
    await api.post('/api/v1/sellers/me/verification').set('authorization', `Bearer ${ownerToken}`).send({ nin: 'synthetic-rejected-value' }).expect(400);
  });

  it('requires an admin and prevents self-approval', async () => {
    await api.patch(`/api/v1/admin/sellers/${ownerSellerId}/status`).set('authorization', `Bearer ${ownerToken}`).send({ status: 'suspended', reason: 'Synthetic customer attempt' }).expect(403);
    const created = await api.post('/api/v1/sellers').set('authorization', `Bearer ${adminToken}`).send({ businessName: 'Admin Synthetic Store', phone: '+2348000000004' }).expect(201);
    adminSellerId = created.body.data.seller.id as string;
    const self = await api.patch(`/api/v1/admin/sellers/${adminSellerId}/status`).set('authorization', `Bearer ${adminToken}`).send({ status: 'suspended', reason: 'Synthetic self decision' }).expect(403);
    assert.equal(self.body.error.code, 'SELF_APPROVAL_FORBIDDEN');
  });

  it('requires verified identity before approval', async () => {
    const response = await api.patch(`/api/v1/admin/sellers/${ownerSellerId}/status`).set('authorization', `Bearer ${adminToken}`).send({ status: 'approved', reason: 'Synthetic approval attempt' }).expect(409);
    assert.equal(response.body.error.code, 'IDENTITY_VERIFICATION_REQUIRED');
  });

  it('suspends sellers, records the decision, and blocks restricted operations', async () => {
    const suspended = await api.patch(`/api/v1/admin/sellers/${ownerSellerId}/status`).set('authorization', `Bearer ${adminToken}`).send({ status: 'suspended', reason: 'Synthetic compliance hold' }).expect(200);
    assert.equal(suspended.body.data.seller.approvalStatus, 'suspended');
    const blocked = await api.post('/api/v1/sellers/me/verification').set('authorization', `Bearer ${ownerToken}`).send({}).expect(403);
    assert.equal(blocked.body.error.code, 'SELLER_SUSPENDED');
    const [rows] = await pool.query<AuditRow[]>("SELECT action, previous_status, new_status, reason, metadata FROM seller_audit_events WHERE seller_id = ? AND action = 'approval_status_changed' ORDER BY id DESC LIMIT 1", [ownerSellerId]);
    assert.equal(rows[0]!.previous_status, 'pending');
    assert.equal(rows[0]!.new_status, 'suspended');
    assert.equal(rows[0]!.reason, 'Synthetic compliance hold');
    assert.equal(JSON.stringify(rows[0]).includes('synthetic-rejected-value'), false);
  });

  it('allows idempotent admin approval only after synthetic verified state', async () => {
    await pool.query("UPDATE sellers SET identity_status = 'verified', approval_status = 'pending', approval_reason = NULL, suspended_at = NULL WHERE id = ?", [ownerSellerId]);
    const approved = await api.patch(`/api/v1/admin/sellers/${ownerSellerId}/status`).set('authorization', `Bearer ${adminToken}`).send({ status: 'approved', reason: 'Synthetic verified fixture' }).expect(200);
    assert.equal(approved.body.data.seller.identityStatus, 'verified');
    assert.equal(approved.body.data.seller.approvalStatus, 'approved');
    await api.patch(`/api/v1/admin/sellers/${ownerSellerId}/status`).set('authorization', `Bearer ${adminToken}`).send({ status: 'approved', reason: 'Repeated synthetic decision' }).expect(200);
    const [rows] = await pool.query<Array<RowDataPacket & { count: number }>>("SELECT COUNT(*) AS count FROM seller_audit_events WHERE seller_id = ? AND action = 'approval_status_changed'", [ownerSellerId]);
    assert.equal(Number(rows[0]!.count), 2);
  });
});
