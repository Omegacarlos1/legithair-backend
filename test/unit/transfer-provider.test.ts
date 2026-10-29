import assert from 'node:assert/strict';
import { PaystackTransferProvider } from '../../src/payouts/provider.js';

describe('Paystack transfer provider adapter', () => {
  it('initiates an NGN balance transfer with the durable reference', async () => {
    let url = ''; let init: RequestInit | undefined;
    const provider = new PaystackTransferProvider('sk_test_synthetic', 'https://paystack.test', 1000, async (input, request) => {
      url = String(input); init = request;
      return new Response(JSON.stringify({ status: true, data: { status: 'pending', reference: 'lh_payout_1234567890', amount: 90000, currency: 'NGN', transfer_code: 'TRF_test', id: '90071992547409931234' } }), { status: 200 });
    });
    const transfer = await provider.initiate({ amountMinor: 90000, currency: 'NGN', recipientCode: 'RCP_test', reference: 'lh_payout_1234567890', reason: 'Synthetic seller payout' });
    assert.equal(url, 'https://paystack.test/transfer');
    assert.deepEqual(JSON.parse(String(init!.body)), { source: 'balance', amount: 90000, recipient: 'RCP_test', reference: 'lh_payout_1234567890', reason: 'Synthetic seller payout', currency: 'NGN' });
    assert.equal(transfer.transferId, '90071992547409931234');
  });

  it('verifies the original transfer reference without creating another transfer', async () => {
    let method = ''; let url = '';
    const provider = new PaystackTransferProvider('sk_test_synthetic', 'https://paystack.test', 1000, async (input, init) => {
      url = String(input); method = init?.method ?? '';
      return new Response(JSON.stringify({ status: true, data: { status: 'success', reference: 'lh_payout_1234567890', amount: 50000, currency: 'NGN', transfer_code: 'TRF_test', id: 123 } }), { status: 200 });
    });
    assert.equal((await provider.verify('lh_payout_1234567890')).status, 'success');
    assert.equal(url, 'https://paystack.test/transfer/verify/lh_payout_1234567890');
    assert.equal(method, 'GET');
  });
});
