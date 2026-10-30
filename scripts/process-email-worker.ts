import { loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/database/pool.js';
import { processOneEmailJob } from '../src/email/job-processor.js';
import { createEmailProvider } from '../src/email/provider.js';

const config = loadConfig();
const pool = createDatabasePool(config);
const provider = createEmailProvider(config);
let stopping = false;

process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
process.stdout.write(`Email worker started with ${config.EMAIL_PROVIDER} provider\n`);

try {
  while (!stopping) {
    try {
      const processed = await processOneEmailJob(pool, provider, config.EMAIL_JOB_LOCK_TIMEOUT_SECONDS);
      if (!processed) await delay(config.EMAIL_WORKER_POLL_MS);
    } catch (error) {
      process.stderr.write(`Email delivery failed: ${error instanceof Error ? error.message : 'unknown provider error'}\n`);
      await delay(config.EMAIL_WORKER_POLL_MS);
    }
  }
} finally {
  await pool.end();
  process.stdout.write('Email worker stopped\n');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
