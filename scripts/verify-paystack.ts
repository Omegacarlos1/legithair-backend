import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { PaystackHttpProvider } from '../src/payments/provider.js';

const config = loadConfig();
const secret = config.PAYSTACK_SECRET_KEY;
const email = process.env.PAYSTACK_ACCEPTANCE_EMAIL;
if (!secret?.startsWith('sk_test_')) throw new Error('Refusing provider acceptance: PAYSTACK_SECRET_KEY must be a Paystack test secret');
if (!email) throw new Error('PAYSTACK_ACCEPTANCE_EMAIL is required');
const provider = new PaystackHttpProvider(secret, config.PAYSTACK_BASE_URL, config.PAYSTACK_TIMEOUT_MS);
const id = randomUUID();
const reference = `LH-ACCEPT-${id.replaceAll('-', '')}`;
const initialized = await provider.initialize({ email, amountMinor: 10_000, currency: 'NGN', reference, metadata: { order_id: id, payment_id: id } });
const verified = await provider.verify(reference);
if (initialized.reference !== reference || verified.reference !== reference || verified.amountMinor !== 10_000 || verified.currency !== 'NGN') throw new Error('Paystack test response did not match the acceptance request');
process.stdout.write(`Paystack test mode accepted initialization and verification for ${reference}; status=${verified.status}; no payment was completed\n`);
