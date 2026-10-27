import assert from 'node:assert/strict';
import request from 'supertest';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import pino from 'pino';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDatabasePool } from '../../src/database/pool.js';
import { migrate } from '../../src/database/migrate.js';
import { processOneEmailJob } from '../../src/email/job-processor.js';
import { FakeEmailProvider } from '../../src/email/provider.js';

interface JobRow extends RowDataPacket { payload: string | { token: string } }
describe('authentication and customer accounts against MariaDB', function () {
  this.timeout(40_000);
  let pool: Pool; let api: ReturnType<typeof request>; let customerId: string; let otherCustomerId: string; let accessToken: string; let refreshToken: string;
  const password = 'ValidPass123!';
  before(async () => {
    process.env.EMAIL_PROVIDER = 'fake';
    const config = loadConfig(); assert.equal(config.NODE_ENV, 'test'); assert.match(config.DATABASE_NAME, /_test$/);
    await migrate('down'); await migrate('up'); pool = createDatabasePool(config);
    api = request(createApp({ pool, logger: pino({ level: 'silent' }), readinessTimeoutMs: 100 }));
  });
  after(async () => { if (pool) await pool.end(); });
  async function latestJobToken(userId: string, type: string): Promise<string> {
    const [rows] = await pool.query<JobRow[]>('SELECT payload FROM durable_jobs WHERE job_type = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload, \'$.userId\')) = ? ORDER BY id DESC LIMIT 1', [type, userId]);
    const payload = typeof rows[0]!.payload === 'string' ? JSON.parse(rows[0]!.payload) as { token: string } : rows[0]!.payload; return payload.token;
  }
  async function registerAndVerify(email: string, name: string): Promise<string> {
    const response = await api.post('/api/v1/auth/register').send({ email, password, displayName: name }).expect(201); const id = response.body.data.userId as string;
    await api.post('/api/v1/auth/verify-email').send({ token: await latestJobToken(id, 'send_verification') }).expect(200); return id;
  }
  it('rejects invalid input and duplicate registration', async () => {
    await api.post('/api/v1/auth/register').send({ email: 'bad', password: 'short', displayName: '' }).expect(400);
    customerId = await registerAndVerify('customer.one@example.test', 'Customer One');
    const duplicate = await api.post('/api/v1/auth/register').send({ email: 'CUSTOMER.ONE@example.test', password, displayName: 'Duplicate' }).expect(409);
    assert.equal(duplicate.body.error.code, 'EMAIL_ALREADY_REGISTERED');
  });
  it('rejects expired verification tokens', async () => {
    const response = await api.post('/api/v1/auth/register').send({ email: 'expired@example.test', password, displayName: 'Expired Token' }).expect(201);
    const token = await latestJobToken(response.body.data.userId, 'send_verification');
    await pool.query("UPDATE auth_tokens SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE user_id = ? AND token_type = 'email_verification'", [response.body.data.userId]);
    const expired = await api.post('/api/v1/auth/verify-email').send({ token }).expect(400); assert.equal(expired.body.error.code, 'TOKEN_EXPIRED');
  });
  it('reissues verification tokens without revealing account state', async () => {
    const registration = await api.post('/api/v1/auth/register').send({ email: 'resend@example.test', password, displayName: 'Resend Customer' }).expect(201);
    const userId = registration.body.data.userId as string;
    const originalToken = await latestJobToken(userId, 'send_verification');
    await api.post('/api/v1/auth/resend-verification').send({ email: 'RESEND@example.test' }).expect(202);
    const replacementToken = await latestJobToken(userId, 'send_verification');
    assert.notEqual(replacementToken, originalToken);
    const revoked = await api.post('/api/v1/auth/verify-email').send({ token: originalToken }).expect(400);
    assert.equal(revoked.body.error.code, 'TOKEN_INVALID_OR_USED');
    await api.post('/api/v1/auth/verify-email').send({ token: replacementToken }).expect(200);
    await api.post('/api/v1/auth/resend-verification').send({ email: 'resend@example.test' }).expect(202);
    await api.post('/api/v1/auth/resend-verification').send({ email: 'unknown@example.test' }).expect(202);
  });
  it('allows only one winner in a concurrent duplicate registration race', async () => {
    const attempts = await Promise.all([
      api.post('/api/v1/auth/register').send({ email: 'race@example.test', password, displayName: 'Race One' }),
      api.post('/api/v1/auth/register').send({ email: 'race@example.test', password, displayName: 'Race Two' })
    ]);
    assert.deepEqual(attempts.map((response) => response.status).sort(), [201, 409]);
  });
  it('logs in verified users and protects profile routes', async () => {
    await api.get('/api/v1/me').expect(401);
    const login = await api.post('/api/v1/auth/login').send({ email: 'customer.one@example.test', password }).expect(200);
    accessToken = login.body.data.tokens.accessToken; refreshToken = login.body.data.tokens.refreshToken;
    const me = await api.get('/api/v1/me').set('authorization', `Bearer ${accessToken}`).expect(200);
    assert.equal(me.body.data.user.id, customerId); assert.deepEqual(me.body.data.user.roles, ['customer']);
  });
  it('enforces address ownership', async () => {
    otherCustomerId = await registerAndVerify('customer.two@example.test', 'Customer Two');
    await api.post('/api/v1/me/addresses').set('authorization', `Bearer ${accessToken}`).send({ label: 'Home', recipientName: 'Customer One', phone: '+2348000000000', line1: '1 Synthetic Street', city: 'Ikeja', state: 'Lagos', isDefault: true }).expect(201);
    const forbidden = await api.get(`/api/v1/users/${otherCustomerId}/addresses`).set('authorization', `Bearer ${accessToken}`).expect(403); assert.equal(forbidden.body.error.code, 'FORBIDDEN');
  });
  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const rotated = await api.post('/api/v1/auth/refresh').send({ token: refreshToken }).expect(200); const newRefresh = rotated.body.data.tokens.refreshToken as string;
    const replay = await api.post('/api/v1/auth/refresh').send({ token: refreshToken }).expect(401); assert.equal(replay.body.error.code, 'REFRESH_TOKEN_REUSED');
    await api.post('/api/v1/auth/refresh').send({ token: newRefresh }).expect(401);
  });
  it('makes password-reset tokens single-use and revokes sessions', async () => {
    await api.post('/api/v1/auth/forgot-password').send({ email: 'customer.one@example.test' }).expect(202); const resetToken = await latestJobToken(customerId, 'send_password_reset');
    await api.post('/api/v1/auth/reset-password').send({ token: resetToken, password: 'NewValidPass123!' }).expect(200);
    const reused = await api.post('/api/v1/auth/reset-password').send({ token: resetToken, password }).expect(400); assert.equal(reused.body.error.code, 'TOKEN_INVALID_OR_USED');
    await api.get('/api/v1/me').set('authorization', `Bearer ${accessToken}`).expect(401);
  });
  it('rejects expired reset tokens without revealing unknown accounts', async () => {
    await api.post('/api/v1/auth/forgot-password').send({ email: 'customer.two@example.test' }).expect(202); const token = await latestJobToken(otherCustomerId, 'send_password_reset');
    await pool.query("UPDATE auth_tokens SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE user_id = ? AND token_type = 'password_reset'", [otherCustomerId]);
    const expired = await api.post('/api/v1/auth/reset-password').send({ token, password: 'AnotherPass123!' }).expect(400); assert.equal(expired.body.error.code, 'TOKEN_EXPIRED');
    await api.post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.test' }).expect(202);
  });
  it('revokes the presented access token on logout', async () => {
    const login = await api.post('/api/v1/auth/login').send({ email: 'customer.one@example.test', password: 'NewValidPass123!' }).expect(200);
    const token = login.body.data.tokens.accessToken as string;
    await api.post('/api/v1/auth/logout').set('authorization', `Bearer ${token}`).expect(204);
    await api.get('/api/v1/me').set('authorization', `Bearer ${token}`).expect(401);
  });
  it('delivers a queued email through the local fake adapter', async () => {
    const provider = new FakeEmailProvider();
    assert.equal(await processOneEmailJob(pool, provider), true);
    assert.equal(provider.deliveries.length, 1);
    const [rows] = await pool.query<Array<RowDataPacket & { count: number }>>("SELECT COUNT(*) AS count FROM durable_jobs WHERE status = 'completed'");
    assert.equal(Number(rows[0]!.count), 1);
  });
  it('returns failed email jobs to the durable retry queue', async () => {
    await assert.rejects(processOneEmailJob(pool, { send: async () => { throw new Error('synthetic provider outage'); } }), /synthetic provider outage/);
    const [rows] = await pool.query<Array<RowDataPacket & { status: string; attempts: number }>>("SELECT status, attempts FROM durable_jobs WHERE last_error = 'synthetic provider outage' ORDER BY id DESC LIMIT 1");
    assert.equal(rows[0]!.status, 'pending'); assert.equal(rows[0]!.attempts, 1);
  });
});
