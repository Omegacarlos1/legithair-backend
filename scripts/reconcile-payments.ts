import { loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/database/pool.js';
import { PaystackHttpProvider } from '../src/payments/provider.js';
import { PaymentService } from '../src/payments/service.js';

const config = loadConfig();
if (!config.PAYSTACK_SECRET_KEY) throw new Error('PAYSTACK_SECRET_KEY is required for payment reconciliation');
const pool = createDatabasePool(config);
try {
  const provider = new PaystackHttpProvider(config.PAYSTACK_SECRET_KEY, config.PAYSTACK_BASE_URL, config.PAYSTACK_TIMEOUT_MS);
  const result = await new PaymentService(pool, provider).reconcilePending();
  process.stdout.write(`Payment reconciliation checked=${result.checked} settled=${result.settled} late=${result.late} failed=${result.failed}\n`);
  if (result.failed > 0) process.exitCode = 1;
} finally { await pool.end(); }
