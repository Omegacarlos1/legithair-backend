import assert from 'node:assert/strict';
import request from 'supertest';
import { testApp, stubPool } from '../helpers.js';

describe('B08 fulfilment API access controls', () => {
  const app = testApp(stubPool(async () => { throw new Error('database must not be called'); }));
  const id = '10000000-0000-4000-8000-000000000001';

  it('requires seller authentication for seller fulfilment changes', async () => {
    const response = await request(app).patch(`/api/v1/seller/orders/${id}/status`).send({ status: 'processing' }).expect(401);
    assert.equal(response.body.error.code, 'UNAUTHENTICATED');
  });

  it('requires admin authentication for refund review and COD reconciliation', async () => {
    const review = await request(app).patch(`/api/v1/admin/returns/${id}`).send({ action: 'reject', adminNote: 'Synthetic rejection' }).expect(401);
    assert.equal(review.body.error.code, 'UNAUTHENTICATED');
    const collection = await request(app).patch(`/api/v1/admin/cod-collections/${id}`).send({ action: 'confirm', note: 'Synthetic confirmation' }).expect(401);
    assert.equal(collection.body.error.code, 'UNAUTHENTICATED');
  });

  it('requires the customer or guest order credential for returns', async () => {
    const response = await request(app).post(`/api/v1/orders/${id}/returns`).set('idempotency-key', 'return-api-0001').send({ items: [{ orderItemId: id, quantity: 1 }], reason: 'Item differs from description' }).expect(401);
    assert.equal(response.body.error.code, 'ORDER_ACCESS_REQUIRED');
  });
});
