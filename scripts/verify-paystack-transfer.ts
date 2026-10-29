import { loadConfig } from '../src/config.js';
import { PaystackTransferProvider } from '../src/payouts/provider.js';

const config = loadConfig();
const reference = process.env.PAYSTACK_TRANSFER_ACCEPTANCE_REFERENCE;
if (!config.PAYSTACK_SECRET_KEY?.startsWith('sk_test_') || !reference) throw new Error('A Paystack test key and PAYSTACK_TRANSFER_ACCEPTANCE_REFERENCE are required');
const transfer = await new PaystackTransferProvider(config.PAYSTACK_SECRET_KEY, config.PAYSTACK_BASE_URL, config.PAYSTACK_TIMEOUT_MS).verify(reference);
process.stdout.write(`${JSON.stringify({ ...transfer, providerMode: 'test' }, null, 2)}\n`);
