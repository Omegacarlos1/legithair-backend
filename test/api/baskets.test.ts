import assert from 'node:assert/strict';
import request from 'supertest';
import { stubPool, testApp } from '../helpers.js';

describe('basket API access controls', () => {
  it('requires a customer or guest credential for basket writes', async () => {
    const response = await request(testApp(stubPool(async () => [[], []] as never)))
      .post('/api/v1/baskets/items')
      .send({ productId: '10000000-0000-4000-8000-000000000010', quantity: 1 })
      .expect(401);
    assert.equal(response.body.error.code, 'BASKET_CREDENTIAL_REQUIRED');
  });

  it('requires admin authentication for delivery-zone changes', async () => {
    await request(testApp(stubPool(async () => [[], []] as never)))
      .patch('/api/v1/admin/delivery-zones/50000000-0000-4000-8000-000000000001')
      .send({ feeMinor: 450000 })
      .expect(401);
  });

  it('does not accept an unknown guest basket token', async () => {
    const response = await request(testApp(stubPool(async () => [[], []] as never)))
      .get('/api/v1/baskets/current')
      .set('x-guest-basket-token', 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789')
      .expect(401);
    assert.equal(response.body.error.code, 'INVALID_GUEST_BASKET');
  });
});
