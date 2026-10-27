import { loadConfig } from '../src/config.js';
import { PaystackRefundProvider } from '../src/refunds/provider.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const secret = config.PAYSTACK_SECRET_KEY;
  if (!secret?.startsWith('sk_test_')) throw new Error('Refusing refund acceptance: PAYSTACK_SECRET_KEY must be a Paystack test secret');
  const transactionReference = process.env.PAYSTACK_REFUND_ACCEPTANCE_TRANSACTION?.trim();
  if (!transactionReference || !/^[A-Za-z0-9.=-]{3,100}$/.test(transactionReference)) throw new Error('PAYSTACK_REFUND_ACCEPTANCE_TRANSACTION must be a completed test transaction reference');
  const amountMinor = Number(process.env.PAYSTACK_REFUND_ACCEPTANCE_AMOUNT_MINOR);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error('PAYSTACK_REFUND_ACCEPTANCE_AMOUNT_MINOR must be a positive integer');
  const provider = new PaystackRefundProvider(secret, config.PAYSTACK_BASE_URL, config.PAYSTACK_TIMEOUT_MS);
  const created = await provider.create({ transactionReference, amountMinor, currency: 'NGN', customerNote: 'Legit Hair B08 test-mode acceptance refund', merchantNote: 'B08 provider acceptance; test mode only' });
  const fetched = await provider.fetch(created.id);
  process.stdout.write(`${JSON.stringify({ mode: 'test', providerRefundId: created.id, createStatus: created.status, fetchedStatus: fetched.status, amountMinor: fetched.amountMinor, currency: fetched.currency })}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
