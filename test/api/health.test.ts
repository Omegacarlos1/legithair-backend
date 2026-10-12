import assert from 'node:assert/strict';
import request from 'supertest';
import { stubPool, testApp } from '../helpers.js';

describe('health API', () => {
  it('reports process health and returns a request ID', async () => {
    const response = await request(testApp(stubPool(async () => [[], []] as never))).get('/health').set('x-request-id', 'fixture-request-001').expect(200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.meta.requestId, 'fixture-request-001');
    assert.equal(response.headers['x-request-id'], 'fixture-request-001');
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
