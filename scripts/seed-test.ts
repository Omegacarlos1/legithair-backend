import argon2 from 'argon2';
import { loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/database/pool.js';

const config = loadConfig();
if (config.NODE_ENV !== 'test' || !config.DATABASE_NAME.endsWith('_test')) throw new Error('Refusing to seed: NODE_ENV must be test and DATABASE_NAME must end with _test');
const pool = createDatabasePool(config);
const fixtures = [
  { id: '10000000-0000-4000-8000-000000000001', email: 'customer.fixture@example.test', name: 'Customer Fixture', role: 'customer' },
  { id: '10000000-0000-4000-8000-000000000002', email: 'admin.fixture@example.test', name: 'Admin Fixture', role: 'admin' }
] as const;
try {
  const passwordHash = await argon2.hash('FixturePass123!', { type: argon2.argon2id });
  for (const fixture of fixtures) {
    await pool.query('INSERT INTO users (id, email, password_hash, display_name, email_verified_at) VALUES (?, ?, ?, ?, NOW(3)) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), display_name = VALUES(display_name), email_verified_at = NOW(3)', [fixture.id, fixture.email, passwordHash, fixture.name]);
    await pool.query('INSERT IGNORE INTO user_roles (user_id, role) VALUES (?, ?)', [fixture.id, fixture.role]);
  }
  process.stdout.write(`Seeded ${fixtures.length} synthetic users. Login password: FixturePass123!\n`);
} finally { await pool.end(); }
