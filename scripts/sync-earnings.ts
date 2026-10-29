import { loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/database/pool.js';
import { EarningsPayoutService } from '../src/payouts/service.js';
import { UnconfiguredTransferProvider } from '../src/payouts/provider.js';

const config = loadConfig();
const pool = createDatabasePool(config);
try {
  const count = await new EarningsPayoutService(pool, new UnconfiguredTransferProvider(), { holdDays: config.EARNINGS_HOLD_DAYS, payoutsEnabled: false }).syncAll();
  process.stdout.write(`Synchronized earnings for ${count} seller(s)\n`);
} finally { await pool.end(); }
