import argon2 from 'argon2';
import { loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/database/pool.js';

const fixtures = [
  { id: '10000000-0000-4000-8000-000000000001', email: 'customer.fixture@example.test', name: 'Customer Fixture', roles: ['customer'] },
  { id: '10000000-0000-4000-8000-000000000002', email: 'admin.fixture@example.test', name: 'Admin Fixture', roles: ['admin'] },
  { id: '10000000-0000-4000-8000-000000000003', email: 'seller.fixture@example.test', name: 'Seller Fixture', roles: ['customer', 'seller'] },
  { id: '10000000-0000-4000-8000-000000000004', email: 'seller.other@example.test', name: 'Other Seller Fixture', roles: ['customer', 'seller'] },
  { id: '10000000-0000-4000-8000-000000000005', email: 'finance.fixture@example.test', name: 'Finance Fixture', roles: ['finance'] }
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
    await pool.query(`INSERT INTO categories (id, name, slug, is_active, created_by)
      VALUES ('70000000-0000-4000-8000-000000000005', 'B05 Basket Fixtures', 'b05-basket-fixtures', TRUE, ?)
      ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = TRUE`, [fixtures[1].id]);
    const basketProducts = [
      { id: '40000000-0000-4000-8000-000000000051', sellerId: syntheticSellers[0]!.id, name: 'Synthetic B05 Straight Wig', slug: 'synthetic-b05-straight-wig', price: 100000 },
      { id: '40000000-0000-4000-8000-000000000052', sellerId: syntheticSellers[1]!.id, name: 'Synthetic B05 Curly Wig', slug: 'synthetic-b05-curly-wig', price: 200000 }
    ];
    for (const product of basketProducts) {
      await pool.query(`INSERT INTO products (id, seller_id, category_id, name, slug, description, price_minor, publication_status, stock_quantity, published_at)
        VALUES (?, ?, '70000000-0000-4000-8000-000000000005', ?, ?, 'Guarded synthetic B05 basket and quote fixture.', ?, 'published', 10, NOW(3))
        ON DUPLICATE KEY UPDATE seller_id = VALUES(seller_id), price_minor = VALUES(price_minor), publication_status = 'published', stock_quantity = 10, published_at = NOW(3)`, [product.id, product.sellerId, product.name, product.slug, product.price]);
    }
    await pool.query(`INSERT INTO addresses (id, user_id, label, recipient_name, phone, line1, city, state, country_code, is_default)
      VALUES ('80000000-0000-4000-8000-000000000005', ?, 'B05 Home', 'Synthetic Customer', '+2348000000000', '10 Synthetic Street', 'Ikeja', 'Lagos', 'NG', TRUE)
      ON DUPLICATE KEY UPDATE city = 'Ikeja', state = 'Lagos', country_code = 'NG', is_default = TRUE`, [fixtures[0].id]);
    await pool.query(`INSERT INTO pickup_locations (id, name, address_line, city, state, fee_minor, min_business_days, max_business_days, is_active, is_synthetic, created_by)
      VALUES ('60000000-0000-4000-8000-000000000005', 'Synthetic B05 Pickup Hub', '1 Synthetic Dispatch Road', 'Ikeja', 'Lagos', 0, 1, 3, TRUE, TRUE, ?)
      ON DUPLICATE KEY UPDATE is_active = TRUE, is_synthetic = TRUE`, [fixtures[1].id]);
    await pool.query(`INSERT INTO indicative_exchange_rates (currency, ngn_minor_per_currency_minor, updated_by)
      VALUES ('USD', 1500, ?) ON DUPLICATE KEY UPDATE ngn_minor_per_currency_minor = 1500, updated_by = VALUES(updated_by), updated_at = NOW(3)`, [fixtures[1].id]);
    process.stdout.write(`Seeded ${fixtures.length} synthetic users, ${syntheticSellers.length} synthetic approved sellers, and ${basketProducts.length} B05-B09 checkout products. Login password: FixturePass123!\n`);
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
