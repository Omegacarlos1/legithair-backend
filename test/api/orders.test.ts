import assert from 'node:assert/strict';
import request from 'supertest';
import { stubPool, testApp } from '../helpers.js';

describe('order API access controls', () => {
  it('requires an order owner credential for checkout', async () => {
    const response = await request(testApp(stubPool(async () => [[], []] as never)))
      .post('/api/v1/orders')
      .set('idempotency-key', 'b06-api-order-01')
      .send({ quoteId: '90000000-0000-4000-8000-000000000001', paymentMethod: 'paystack' })
      .expect(401);
    assert.equal(response.body.error.code, 'ORDER_OWNER_REQUIRED');
  });

  it('requires a customer or tracking credential to read an order', async () => {
    const response = await request(testApp(stubPool(async () => [[], []] as never)))
      .get('/api/v1/orders/90000000-0000-4000-8000-000000000001')
      .expect(401);
    assert.equal(response.body.error.code, 'ORDER_ACCESS_REQUIRED');
  });
});
