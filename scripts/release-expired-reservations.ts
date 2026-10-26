import { loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/database/pool.js';
import { OrderService } from '../src/orders/service.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createDatabasePool(config);
  try {
    const service = new OrderService(pool, {
      reservationTtlSeconds: config.ORDER_RESERVATION_TTL_SECONDS,
      commissionBasis: config.ORDER_COMMISSION_BASIS,
      commissionRateBps: config.ORDER_COMMISSION_RATE_BPS,
      codEnabled: config.COD_ENABLED,
      guestTokenSecret: config.ORDER_GUEST_TOKEN_SECRET
    });
    const released = await service.releaseExpiredReservations();
    process.stdout.write(`Released ${released} expired order reservation(s).\n`);
  } finally { await pool.end(); }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
