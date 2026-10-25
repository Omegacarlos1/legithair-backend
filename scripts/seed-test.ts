import argon2 from 'argon2';
import { loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/database/pool.js';

const fixtures = [
  { id: '10000000-0000-4000-8000-000000000001', email: 'customer.fixture@example.test', name: 'Customer Fixture', roles: ['customer'] },
  { id: '10000000-0000-4000-8000-000000000002', email: 'admin.fixture@example.test', name: 'Admin Fixture', roles: ['admin'] },
  { id: '10000000-0000-4000-8000-000000000003', email: 'seller.fixture@example.test', name: 'Seller Fixture', roles: ['customer', 'seller'] },
  { id: '10000000-0000-4000-8000-000000000004', email: 'seller.other@example.test', name: 'Other Seller Fixture', roles: ['customer', 'seller'] }
] as const;
export async function seedTestFixtures(): Promise<void> {
  const config = loadConfig();
  if (config.NODE_ENV !== 'test' || !config.DATABASE_NAME.endsWith('_test')) throw new Error('Refusing to seed: NODE_ENV must be test and DATABASE_NAME must end with _test');
  const pool = createDatabasePool(config);
  try {
    const passwordHash = await argon2.hash('FixturePass123!', { type: argon2.argon2id });
    for (const fixture of fixtures) {
      await pool.query('INSERT INTO users (id, email, password_hash, display_name, email_verified_at) VALUES (?, ?, ?, ?, NOW(3)) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), display_name = VALUES(display_name), email_verified_at = NOW(3)', [fixture.id, fixture.email, passwordHash, fixture.name]);
      for (const role of fixture.roles) await pool.query('INSERT IGNORE INTO user_roles (user_id, role) VALUES (?, ?)', [fixture.id, role]);
    }
    const syntheticSellers = [
      { id: '20000000-0000-4000-8000-000000000001', userId: fixtures[2].id, businessName: 'Synthetic Approved Seller' },
      { id: '20000000-0000-4000-8000-000000000002', userId: fixtures[3].id, businessName: 'Synthetic Other Seller' }
    ];
    for (const seller of syntheticSellers) {
      await pool.query(
        `INSERT INTO sellers (id, user_id, business_name, phone, identity_status, approval_status, approval_reason, approved_by, approved_at)
         VALUES (?, ?, ?, '+2348000000000', 'verified', 'approved', 'Synthetic B04 test fixture only', ?, NOW(3))
         ON DUPLICATE KEY UPDATE business_name = VALUES(business_name), identity_status = 'verified', approval_status = 'approved', approval_reason = VALUES(approval_reason), approved_by = VALUES(approved_by), approved_at = NOW(3), suspended_at = NULL`,
        [seller.id, seller.userId, seller.businessName, fixtures[1].id]
      );
    }
    process.stdout.write(`Seeded ${fixtures.length} synthetic users and ${syntheticSellers.length} synthetic approved sellers. Login password: FixturePass123!\n`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/seed-test.ts')) {
  void seedTestFixtures().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
