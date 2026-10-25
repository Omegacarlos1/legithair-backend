import assert from 'node:assert/strict';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { loadConfig } from '../../src/config.js';
import { migrate } from '../../src/database/migrate.js';

describe('MariaDB migrations', () => {
  it('apply cleanly and create the B01-B05 tables', async () => {
    process.env.EMAIL_PROVIDER = 'fake';
    const config = loadConfig();
    assert.equal(config.NODE_ENV, 'test');
    assert.match(config.DATABASE_NAME, /_test$/);
    await migrate('down');
    await migrate('up');
    const connection = await mysql.createConnection({ host: config.DATABASE_HOST, port: config.DATABASE_PORT, user: config.DATABASE_USER, password: config.DATABASE_PASSWORD, database: config.DATABASE_NAME });
    try {
      const expected = ['addresses', 'auth_tokens', 'basket_items', 'baskets', 'categories', 'checkout_quote_delivery_allocations', 'checkout_quote_items', 'checkout_quotes', 'delivery_config_audit_events', 'delivery_zones', 'durable_jobs', 'indicative_exchange_rates', 'outbox_events', 'pickup_locations', 'product_audit_events', 'product_images', 'products', 'seller_audit_events', 'sellers', 'stock_adjustments', 'user_roles', 'users'];
      const [rows] = await connection.query<Array<RowDataPacket & { table_name: string }>>(`SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name IN (${expected.map(() => '?').join(', ')})`, [config.DATABASE_NAME, ...expected]);
      assert.deepEqual(rows.map((row) => row.table_name).sort(), expected);
    } finally { await connection.end(); }
  });
});
