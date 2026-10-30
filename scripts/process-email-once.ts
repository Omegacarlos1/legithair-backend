import { loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/database/pool.js';
import { processOneEmailJob } from '../src/email/job-processor.js';
import { createEmailProvider } from '../src/email/provider.js';

const config = loadConfig();
const pool = createDatabasePool(config);
const provider = createEmailProvider(config);
try {
  const processed = await processOneEmailJob(pool, provider, config.EMAIL_JOB_LOCK_TIMEOUT_SECONDS);
  process.stdout.write(processed ? `Email job delivered through ${config.EMAIL_PROVIDER}\n` : 'No email job is ready\n');
} finally { await pool.end(); }
