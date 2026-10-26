import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { PaystackHttpProvider, verifyPaystackSignature } from '../../src/payments/provider.js';

describe('Paystack provider adapter', () => {
  it('initializes an NGN transaction with server-controlled fields', async () => {
    let requestUrl = '';
    let requestInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({ status: true, data: { authorization_url: 'https://checkout.paystack.test/abc', access_code: 'abc', reference: 'LH-abc' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const provider = new PaystackHttpProvider('sk_test_synthetic', 'https://paystack.test', 1000, fetcher);
    const result = await provider.initialize({ email: 'buyer@example.test', amountMinor: 125000, currency: 'NGN', reference: 'LH-abc', callbackUrl: 'https://store.example.test/payment-return', metadata: { order_id: 'order-1', payment_id: 'payment-1' } });
    assert.equal(requestUrl, 'https://paystack.test/transaction/initialize');
    assert.equal((requestInit!.headers as Record<string, string>).authorization, 'Bearer sk_test_synthetic');
    assert.deepEqual(JSON.parse(String(requestInit!.body)), { email: 'buyer@example.test', amount: '125000', currency: 'NGN', reference: 'LH-abc', metadata: { order_id: 'order-1', payment_id: 'payment-1' }, callback_url: 'https://store.example.test/payment-return' });
    assert.equal(result.reference, 'LH-abc');
  });

  it('parses verification data without coercing the provider transaction identifier', async () => {
    const provider = new PaystackHttpProvider('sk_test_synthetic', 'https://paystack.test', 1000, async () => new Response(JSON.stringify({ status: true, data: { status: 'success', reference: 'LH-ref', amount: 50000, currency: 'NGN', id: '18446744073709551615', paid_at: '2026-10-26T12:00:00.000Z', metadata: { order_id: 'order-1', payment_id: 'payment-1' } } }), { status: 200 }));
    const result = await provider.verify('LH-ref');
    assert.equal(result.providerTransactionId, '18446744073709551615');
    assert.equal(result.paidAt?.toISOString(), '2026-10-26T12:00:00.000Z');
  });

  it('verifies the documented HMAC SHA-512 raw-body signature', () => {
    const raw = Buffer.from('{"event":"charge.success"}');
    const signature = createHmac('sha512', 'sk_test_synthetic').update(raw).digest('hex');
    assert.equal(verifyPaystackSignature(raw, signature, 'sk_test_synthetic'), true);
    assert.equal(verifyPaystackSignature(Buffer.from('{}'), signature, 'sk_test_synthetic'), false);
    assert.equal(verifyPaystackSignature(raw, 'not-a-signature', 'sk_test_synthetic'), false);
  });
});
