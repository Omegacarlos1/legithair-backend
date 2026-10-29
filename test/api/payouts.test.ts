import assert from 'node:assert/strict';
import request from 'supertest';
import { createHash } from 'node:crypto';
import type { Pool, QueryOptions } from 'mysql2/promise';
import { testApp, stubPool } from '../helpers.js';

describe('B09 payout API access controls', () => {
  it('requires seller authentication for earnings', async () => {
    const response = await request(testApp(stubPool(async () => { throw new Error('database must not be called'); }))).get('/api/v1/seller/earnings').expect(401);
    assert.equal(response.body.error.code, 'UNAUTHENTICATED');
  });

  for (const role of ['customer', 'seller'] as const) {
    it(`does not allow ${role} to approve a payout`, async () => {
      const raw = `${role}-synthetic-token`;
      const userId = role === 'customer' ? '10000000-0000-4000-8000-000000000001' : '10000000-0000-4000-8000-000000000002';
      const query = (async (input: string | QueryOptions) => {
        const sql = typeof input === 'string' ? input : input.sql;
        if (sql.includes('FROM auth_tokens')) return [[{ user_id: userId, token_hash: createHash('sha256').update(raw).digest('hex') }], []];
        if (sql.includes('FROM users')) return [[{ id: userId, email: `${role}@example.test`, display_name: role, email_verified_at: new Date() }], []];
        if (sql.includes('FROM user_roles')) return [[{ role }], []];
        throw new Error(`unexpected query: ${sql}`);
      }) as Pool['query'];
      const pool = stubPool(query);
      const response = await request(testApp(pool)).post('/api/v1/admin/payouts').set('authorization', `Bearer ${raw}`).set('idempotency-key', 'payout-api-0001').send({ sellerId: '20000000-0000-4000-8000-000000000001', amountMinor: 1000 }).expect(403);
      assert.equal(response.body.error.code, 'FORBIDDEN');
    });
  }
});
