import { loadConfig } from '../src/config.js';
import { createGmailEmailProvider } from '../src/email/provider.js';

const config = loadConfig();
const provider = createGmailEmailProvider(config);
await provider.verifyConnection();
process.stdout.write('Gmail SMTP authentication succeeded\n');
