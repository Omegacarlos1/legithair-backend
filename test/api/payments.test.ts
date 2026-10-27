import assert from 'node:assert/strict';
import request from 'supertest';
import type { PaymentProvider } from '../../src/payments/provider.js';
import { stubPool, testApp } from '../helpers.js';
import { createApp } from '../../src/app.js';
import pino from 'pino';

const provider: PaymentProvider = {
  initialize: async () => { throw new Error('not called'); },
  verify: async () => { throw new Error('not called'); }
};

describe('payment API access and webhook controls', () => {
  it('requires an order-owner credential for initialization and receipts', async () => {
    const app = testApp(stubPool(async () => [[], []] as never));
    const initialized = await request(app).post('/api/v1/payments/initialize').send({ orderId: '90000000-0000-4000-8000-000000000001' }).expect(401);
    assert.equal(initialized.body.error.code, 'ORDER_ACCESS_REQUIRED');
    const receipt = await request(app).get('/api/v1/orders/90000000-0000-4000-8000-000000000001/receipt').expect(401);
    assert.equal(receipt.body.error.code, 'ORDER_ACCESS_REQUIRED');
  });

  it('rejects a forged Paystack webhook before any database work', async () => {
    const app = createApp({ pool: stubPool(async () => { throw new Error('database must not be called'); }), logger: pino({ level: 'silent' }), readinessTimeoutMs: 100, paymentProvider: provider, paystackWebhookSecret: 'sk_test_webhook_secret' });
    const response = await request(app).post('/api/v1/payments/webhooks/paystack').set('x-paystack-signature', '0'.repeat(128)).send({ event: 'charge.success', data: {} }).expect(401);
    assert.equal(response.body.error.code, 'INVALID_WEBHOOK_SIGNATURE');
  });
});
