import assert from 'node:assert/strict';
import request from 'supertest';
import { stubPool, testApp } from '../helpers.js';

describe('catalogue API authentication', () => {
  it('rejects unauthenticated seller product creation', async () => {
    const response = await request(testApp(stubPool(async () => [[], []] as never)))
      .post('/api/v1/seller/products')
      .send({ categoryId: '10000000-0000-4000-8000-000000000010', name: 'Test Product', description: 'Synthetic product description', priceMinor: 1000 })
      .expect(401);
    assert.equal(response.body.error.code, 'UNAUTHENTICATED');
  });

  it('rejects unauthenticated category administration', async () => {
    const response = await request(testApp(stubPool(async () => [[], []] as never)))
      .post('/api/v1/admin/categories')
      .send({ name: 'Wigs' })
      .expect(401);
    assert.equal(response.body.error.code, 'UNAUTHENTICATED');
  });
});
