import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { loadConfig } from '../src/config.js';
import { migrate } from '../src/database/migrate.js';

const RESTORE_DATABASE = 'legit_hair_b12_restore_test';
const TABLES = ['schema_migrations', 'users', 'orders', 'support_messages', 'email_deliveries'] as const;

export async function verifyBackupRestore(): Promise<void> {
  const source = loadConfig();
  if (source.NODE_ENV !== 'test' || !source.DATABASE_NAME.endsWith('_test')) throw new Error('Refusing backup verification outside a source database ending _test');
  if (!/_test$/.test(RESTORE_DATABASE) || RESTORE_DATABASE === source.DATABASE_NAME) throw new Error('Unsafe restore database target');
  const restoreUser = process.env.BACKUP_RESTORE_DATABASE_USER || source.DATABASE_USER;
  const restorePassword = restoreUser === source.DATABASE_USER ? source.DATABASE_PASSWORD : process.env.BACKUP_RESTORE_DATABASE_PASSWORD ?? '';
  const scratch = await mkdtemp(join(tmpdir(), 'legit-b12-backup-'));
  const dumpPath = join(scratch, 'backup.sql');
  const dumpBinary = process.env.MYSQL_DUMP_BIN || 'C:\\xampp\\mysql\\bin\\mysqldump.exe';
  const clientBinary = process.env.MYSQL_CLIENT_BIN || 'C:\\xampp\\mysql\\bin\\mysql.exe';
  const dumpEnvironment = { ...process.env, MYSQL_PWD: source.DATABASE_PASSWORD };
  const restoreEnvironment = { ...process.env, MYSQL_PWD: restorePassword };
  const sourceConnection = { host: source.DATABASE_HOST, port: source.DATABASE_PORT, user: source.DATABASE_USER, password: source.DATABASE_PASSWORD };
  const restoreConnection = { host: source.DATABASE_HOST, port: source.DATABASE_PORT, user: restoreUser, password: restorePassword };
  const connection = await mysql.createConnection(restoreConnection);
  const originalEnvironment = { database: process.env.DATABASE_NAME, user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD };
  try {
    await run(dumpBinary, ['--host', source.DATABASE_HOST, '--port', String(source.DATABASE_PORT), '--user', source.DATABASE_USER, '--single-transaction', '--skip-lock-tables', '--triggers', `--result-file=${dumpPath}`, source.DATABASE_NAME], dumpEnvironment);
    const sourceCounts = await tableCounts(source.DATABASE_NAME, sourceConnection);
    await recreateDatabase(connection, RESTORE_DATABASE);
    await run(clientBinary, ['--host', source.DATABASE_HOST, '--port', String(source.DATABASE_PORT), '--user', restoreUser, RESTORE_DATABASE], restoreEnvironment, dumpPath);
    assertCounts(sourceCounts, await tableCounts(RESTORE_DATABASE, restoreConnection), 'initial restore');

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_NAME = RESTORE_DATABASE;
    process.env.DATABASE_USER = restoreUser;
    process.env.DATABASE_PASSWORD = restorePassword;
    await migrate('down');
    await migrate('up');

    await recreateDatabase(connection, RESTORE_DATABASE);
    await run(clientBinary, ['--host', source.DATABASE_HOST, '--port', String(source.DATABASE_PORT), '--user', restoreUser, RESTORE_DATABASE], restoreEnvironment, dumpPath);
    const finalCounts = await tableCounts(RESTORE_DATABASE, restoreConnection);
    assertCounts(sourceCounts, finalCounts, 'post-migration recovery restore');
    const dump = await readFile(dumpPath);
    process.stdout.write(`${JSON.stringify({ source: source.DATABASE_NAME, restoredTo: RESTORE_DATABASE, dumpBytes: dump.length, sha256: createHash('sha256').update(dump).digest('hex'), tables: finalCounts, rollbackForwardCycle: 'passed', finalRestore: 'passed' })}\n`);
  } finally {
    restoreVariable('DATABASE_NAME', originalEnvironment.database);
    restoreVariable('DATABASE_USER', originalEnvironment.user);
    restoreVariable('DATABASE_PASSWORD', originalEnvironment.password);
    await connection.end();
    await rm(scratch, { recursive: true, force: true });
  }
}

async function recreateDatabase(connection: mysql.Connection, database: string): Promise<void> {
  if (!/^[A-Za-z0-9_]+_test$/.test(database)) throw new Error('Unsafe restore database target');
  await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
}

async function tableCounts(database: string, connection: { host: string; port: number; user: string; password: string }): Promise<Record<string, number>> {
  const pool = mysql.createPool({ ...connection, database, connectionLimit: 2 });
  try {
    const counts: Record<string, number> = {};
    for (const table of TABLES) {
      const [rows] = await pool.query<Array<RowDataPacket & { total: number | string }>>(`SELECT COUNT(*) AS total FROM \`${table}\``);
      counts[table] = Number(rows[0]?.total ?? 0);
    }
    return counts;
  } finally { await pool.end(); }
}

function restoreVariable(name: 'DATABASE_NAME' | 'DATABASE_USER' | 'DATABASE_PASSWORD', value: string | undefined): void {
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
}

function assertCounts(expected: Record<string, number>, actual: Record<string, number>, phase: string): void {
  for (const table of TABLES) if (actual[table] !== expected[table]) throw new Error(`${phase} count mismatch for ${table}`);
}

function run(command: string, args: string[], environment: NodeJS.ProcessEnv, inputFile?: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env: environment, stdio: [inputFile ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    if (inputFile) createReadStream(inputFile).pipe(child.stdin!);
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} failed with exit ${code}: ${stderr.trim().slice(0, 500)}`)));
  });
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  void verifyBackupRestore().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
