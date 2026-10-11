import assert from 'node:assert/strict';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { loadConfig } from '../../src/config.js';
import { migrate } from '../../src/database/migrate.js';

describe('MariaDB migrations', () => {
  it('apply cleanly and create the B01 durable tables', async () => {
    const config = loadConfig();
    assert.equal(config.NODE_ENV, 'test');
    assert.match(config.DATABASE_NAME, /_test$/);
    await migrate('down');
    await migrate('up');
    const connection = await mysql.createConnection({ host: config.DATABASE_HOST, port: config.DATABASE_PORT, user: config.DATABASE_USER, password: config.DATABASE_PASSWORD, database: config.DATABASE_NAME });
    try {
      const [rows] = await connection.query<Array<RowDataPacket & { table_name: string }>>('SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name IN (?, ?)', [config.DATABASE_NAME, 'durable_jobs', 'outbox_events']);
      assert.deepEqual(rows.map((row) => row.table_name).sort(), ['durable_jobs', 'outbox_events']);
    } finally { await connection.end(); }
  });
});
