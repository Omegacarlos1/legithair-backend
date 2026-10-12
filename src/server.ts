import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createDatabasePool } from './database/pool.js';
import { createApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const pool = createDatabasePool(config);
  await pool.query('SELECT 1');
  logger.info(
    { database: config.DATABASE_NAME, host: config.DATABASE_HOST, port: config.DATABASE_PORT },
    'Database connected successfully'
  );
  const app = createApp({ pool, logger, readinessTimeoutMs: config.READINESS_TIMEOUT_MS });
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
