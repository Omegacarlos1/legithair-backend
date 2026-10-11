import { loadConfig } from '../src/config.js';

const config = loadConfig();
if (config.NODE_ENV !== 'test' || !config.DATABASE_NAME.endsWith('_test')) {
  throw new Error('Refusing to seed: NODE_ENV must be test and DATABASE_NAME must end with _test');
}
process.stdout.write('B01 has no domain fixtures to seed. Test database safety checks passed.\n');
