import assert from 'node:assert/strict';
import request from 'supertest';
import pino from 'pino';
import { createApp } from '../../src/app.js';
import { stubPool, testApp } from '../helpers.js';

describe('health API', () => {
  it('reports process health and returns a request ID', async () => {
    const response = await request(testApp(stubPool(async () => [[], []] as never))).get('/health').set('x-request-id', 'fixture-request-001').expect(200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.meta.requestId, 'fixture-request-001');
    assert.equal(response.headers['x-request-id'], 'fixture-request-001');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['x-frame-options'], 'DENY');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
  });

  it('allows only configured browser origins and handles preflight', async () => {
    const app = createApp({ pool: stubPool(async () => [[], []] as never), logger: pino({ level: 'silent' }), readinessTimeoutMs: 100, corsAllowedOrigins: ['https://shop.example.test'] });
    const allowed = await request(app).options('/api/v1/products').set('origin', 'https://shop.example.test').expect(204);
    assert.equal(allowed.headers['access-control-allow-origin'], 'https://shop.example.test');
    const denied = await request(app).get('/health').set('origin', 'https://evil.example.test').expect(403);
    assert.equal(denied.body.error.code, 'ORIGIN_NOT_ALLOWED');
  });

  it('normalizes malformed and oversized JSON without exposing internals', async () => {
    const app = testApp(stubPool(async () => [[], []] as never));
    const malformed = await request(app).post('/api/v1/auth/login').set('content-type', 'application/json').send('{"email":').expect(400);
    assert.equal(malformed.body.error.code, 'INVALID_JSON');
    const oversized = await request(app).post('/api/v1/auth/login').set('content-type', 'application/json').send(`{"value":"${'a'.repeat(1_100_000)}"}`).expect(413);
    assert.equal(oversized.body.error.code, 'REQUEST_TOO_LARGE');
  });

  it('adds HSTS only for production responses', async () => {
    const pool = stubPool(async () => [[], []] as never);
    const production = createApp({ pool, logger: pino({ level: 'silent' }), readinessTimeoutMs: 100, nodeEnv: 'production' });
    const response = await request(production).get('/health').expect(200);
    assert.match(String(response.headers['strict-transport-security']), /max-age=31536000/);
  });

  it('reports readiness when the database responds', async () => {
    const response = await request(testApp(stubPool(async () => [[], []] as never))).get('/ready').expect(200);
    assert.equal(response.body.data.database, 'available');
  });

  it('returns 503 without leaking the database error', async () => {
    const secret = 'mysql://user:secret@localhost';
    const response = await request(testApp(stubPool(async () => { throw new Error(secret); }))).get('/ready').expect(503);
    assert.equal(JSON.stringify(response.body).includes(secret), false);
    assert.equal(response.body.error.code, 'SERVICE_UNAVAILABLE');
  });

  it('uses the error envelope for unknown routes', async () => {
    const response = await request(testApp(stubPool(async () => [[], []] as never))).get('/missing').expect(404);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error.code, 'NOT_FOUND');
  });
});
