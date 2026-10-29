import { loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/database/pool.js';
import { EarningsPayoutService } from '../src/payouts/service.js';
import { PaystackTransferProvider, UnconfiguredTransferProvider } from '../src/payouts/provider.js';

const config = loadConfig();
const pool = createDatabasePool(config);
const provider = config.PAYSTACK_SECRET_KEY ? new PaystackTransferProvider(config.PAYSTACK_SECRET_KEY, config.PAYSTACK_BASE_URL, config.PAYSTACK_TIMEOUT_MS) : new UnconfiguredTransferProvider();
try {
  const count = await new EarningsPayoutService(pool, provider, { holdDays: config.EARNINGS_HOLD_DAYS, payoutsEnabled: config.PAYOUTS_ENABLED }).reconcilePending();
  process.stdout.write(`Reconciled ${count} payout(s)\n`);
} finally { await pool.end(); }
