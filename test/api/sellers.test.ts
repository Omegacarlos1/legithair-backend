import assert from 'node:assert/strict';
import request from 'supertest';
import { stubPool, testApp } from '../helpers.js';

describe('seller API authentication', () => {
  it('rejects unauthenticated seller profile creation', async () => {
    const response = await request(testApp(stubPool(async () => [[], []] as never)))
      .post('/api/v1/sellers')
      .send({ businessName: 'Synthetic Hair Store', phone: '+2348000000000' })
      .expect(401);
    assert.equal(response.body.error.code, 'UNAUTHENTICATED');
  });

  it('rejects unauthenticated admin seller decisions', async () => {
    const response = await request(testApp(stubPool(async () => [[], []] as never)))
      .patch('/api/v1/admin/sellers/10000000-0000-4000-8000-000000000010/status')
      .send({ status: 'suspended', reason: 'Synthetic policy decision' })
      .expect(401);
    assert.equal(response.body.error.code, 'UNAUTHENTICATED');
  });
});
