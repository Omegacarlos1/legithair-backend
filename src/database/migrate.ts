import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { createDatabasePool } from './pool.js';
import type { RowDataPacket } from 'mysql2/promise';

interface MigrationRow extends RowDataPacket { name: string }

export async function migrate(direction: 'up' | 'down' = 'up'): Promise<void> {
  const config = loadConfig();
  const pool = createDatabasePool(config);
  try {
    await pool.query('SELECT 1');
    process.stdout.write(`Database connected successfully (${config.DATABASE_NAME})\n`);
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`);
    const directory = resolve(process.cwd(), 'migrations');
    const files = (await readdir(directory)).filter((file) => direction === 'up' ? /^\d+.*\.sql$/.test(file) && !file.endsWith('.down.sql') : file.endsWith('.down.sql')).sort();
    if (direction === 'down') files.reverse();
    for (const file of files) {
      const migrationName = file.replace('.down.sql', '.sql');
      const [rows] = await pool.query<MigrationRow[]>('SELECT name FROM schema_migrations WHERE name = ?', [migrationName]);
      if (direction === 'up' && rows.length > 0) continue;
      if (direction === 'down' && rows.length === 0) continue;
      const sql = await readFile(resolve(directory, file), 'utf8');
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) await connection.query(statement);
        if (direction === 'up') await connection.query('INSERT INTO schema_migrations (name) VALUES (?)', [migrationName]);
        else await connection.query('DELETE FROM schema_migrations WHERE name = ?', [migrationName]);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally { connection.release(); }
    }
    process.stdout.write(`Migrations ${direction === 'up' ? 'applied' : 'rolled back'} successfully\n`);
  } finally { await pool.end(); }
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const direction = process.argv[2] === 'down' ? 'down' : 'up';
  migrate(direction).catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
