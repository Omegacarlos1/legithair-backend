import type { RowDataPacket } from 'mysql2/promise';
import { loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/database/pool.js';
import { FulfilmentService } from '../src/fulfilment/service.js';
import { PaystackRefundProvider } from '../src/refunds/provider.js';

interface RefundIdRow extends RowDataPacket { id: string }

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.PAYSTACK_SECRET_KEY) throw new Error('PAYSTACK_SECRET_KEY is required for refund reconciliation');
  const pool = createDatabasePool(config);
  try {
    const provider = new PaystackRefundProvider(config.PAYSTACK_SECRET_KEY, config.PAYSTACK_BASE_URL, config.PAYSTACK_TIMEOUT_MS);
    const service = new FulfilmentService(pool, provider, {});
    const [rows] = await pool.query<RefundIdRow[]>("SELECT id FROM refunds WHERE provider_refund_id IS NOT NULL AND status IN ('pending', 'processing', 'needs_attention') ORDER BY updated_at LIMIT 100");
    let reconciled = 0;
    for (const row of rows) { await service.reconcileRefund(row.id); reconciled++; }
    process.stdout.write(`Reconciled ${reconciled} refund(s)\n`);
  } finally { await pool.end(); }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
