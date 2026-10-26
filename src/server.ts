import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createDatabasePool } from './database/pool.js';
import { createApp } from './app.js';
import { PaystackHttpProvider, UnconfiguredPaymentProvider } from './payments/provider.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const pool = createDatabasePool(config);
  await pool.query('SELECT 1');
  logger.info(
    { database: config.DATABASE_NAME, host: config.DATABASE_HOST, port: config.DATABASE_PORT },
    'Database connected successfully'
  );
  const paymentProvider = config.PAYSTACK_SECRET_KEY ? new PaystackHttpProvider(config.PAYSTACK_SECRET_KEY, config.PAYSTACK_BASE_URL, config.PAYSTACK_TIMEOUT_MS) : new UnconfiguredPaymentProvider();
  const app = createApp({ pool, logger, readinessTimeoutMs: config.READINESS_TIMEOUT_MS, imageStorageRoot: config.IMAGE_STORAGE_ROOT, imageMaxBytes: config.IMAGE_MAX_BYTES, guestBasketTtlDays: config.GUEST_BASKET_TTL_DAYS, checkoutQuoteTtlSeconds: config.CHECKOUT_QUOTE_TTL_SECONDS, orderPolicy: { reservationTtlSeconds: config.ORDER_RESERVATION_TTL_SECONDS, commissionBasis: config.ORDER_COMMISSION_BASIS, commissionRateBps: config.ORDER_COMMISSION_RATE_BPS, codEnabled: config.COD_ENABLED, guestTokenSecret: config.ORDER_GUEST_TOKEN_SECRET }, paymentProvider, paystackWebhookSecret: config.PAYSTACK_SECRET_KEY, paystackCallbackUrl: config.PAYSTACK_CALLBACK_URL });
  const server = app.listen(config.PORT, config.HOST, () => logger.info({ host: config.HOST, port: config.PORT }, 'Server listening'));
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => void pool.end().finally(() => process.exit(0)));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Application failed to start'}\n`);
  process.exitCode = 1;
});
