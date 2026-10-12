import { loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/database/pool.js';
import { processOneEmailJob } from '../src/email/job-processor.js';
import { FakeEmailProvider } from '../src/email/provider.js';

const pool = createDatabasePool(loadConfig()); const provider = new FakeEmailProvider();
try {
  const processed = await processOneEmailJob(pool, provider);
  process.stdout.write(processed ? `Fake email delivered to ${provider.deliveries[0]!.to}\n` : 'No email job is ready\n');
} finally { await pool.end(); }
