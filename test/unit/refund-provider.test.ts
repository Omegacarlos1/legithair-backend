import assert from 'node:assert/strict';
import { PaystackRefundProvider } from '../../src/refunds/provider.js';

describe('Paystack refund provider adapter', () => {
  it('creates an exact NGN partial refund using the transaction reference', async () => {
    let requestUrl = ''; let requestInit: RequestInit | undefined;
    const provider = new PaystackRefundProvider('sk_test_synthetic', 'https://paystack.test', 1000, async (url, init) => {
      requestUrl = String(url); requestInit = init;
      return new Response(JSON.stringify({ status: true, data: { id: 123456789012345, status: 'pending', amount: 50000, currency: 'NGN', transaction: { reference: 'LH-order-1' }, refunded_at: null } }), { status: 200 });
    });
    const result = await provider.create({ transactionReference: 'LH-order-1', amountMinor: 50000, currency: 'NGN', customerNote: 'Return approved', merchantNote: 'Legit Hair return' });
    assert.equal(requestUrl, 'https://paystack.test/refund');
    assert.deepEqual(JSON.parse(String(requestInit!.body)), { transaction: 'LH-order-1', amount: 50000, currency: 'NGN', customer_note: 'Return approved', merchant_note: 'Legit Hair return' });
    assert.equal(result.id, '123456789012345');
    assert.equal(result.status, 'pending');
  });

  it('fetches a delayed refund without coercing its provider identifier', async () => {
    const provider = new PaystackRefundProvider('sk_test_synthetic', 'https://paystack.test', 1000, async () => new Response(JSON.stringify({ status: true, data: { id: '18446744073709551615', status: 'processed', amount: 50000, currency: 'NGN', refunded_at: '2026-10-27T12:00:00.000Z' } }), { status: 200 }));
    const result = await provider.fetch('18446744073709551615');
    assert.equal(result.id, '18446744073709551615');
    assert.equal(result.status, 'processed');
    assert.equal(result.processedAt?.toISOString(), '2026-10-27T12:00:00.000Z');
  });
});
