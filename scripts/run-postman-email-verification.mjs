import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import mysql from 'mysql2/promise';

const databaseName = process.env.DATABASE_NAME;
if (process.env.NODE_ENV !== 'test' || databaseName !== 'legit_hair_app_test') {
  throw new Error('Refusing to read an email token outside legit_hair_app_test.');
}

const connection = await mysql.createConnection({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT ?? 3306),
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: databaseName,
});

let verificationToken;
try {
  const [rows] = await connection.query(
    `SELECT j.payload
       FROM durable_jobs j
       JOIN users u
         ON u.id = JSON_UNQUOTE(JSON_EXTRACT(j.payload, '$.userId'))
      WHERE j.job_type = 'send_verification'
        AND u.email_verified_at IS NULL
      ORDER BY j.id DESC
      LIMIT 1`,
  );
  if (rows.length === 0) {
    throw new Error(
      'No pending synthetic verification token was found. Run the full-regression folder first.',
    );
  }
  const payload =
    typeof rows[0].payload === 'string'
      ? JSON.parse(rows[0].payload)
      : rows[0].payload;
  verificationToken = payload.token;
  if (typeof verificationToken !== 'string' || verificationToken.length === 0) {
    throw new Error('The pending fake-email job does not contain a verification token.');
  }
} finally {
  await connection.end();
}

const executable = process.platform === 'win32' ? 'postman.exe' : 'postman';
const result = spawnSync(
  executable,
  [
    'collection',
    'run',
    'postman/Legit_Hair_Backend.postman_collection.json',
    '-e',
    'postman/Local.postman_environment.json',
    '-i',
    'Manual - B02 Verify email token',
    '--env-var',
    `verificationToken=${verificationToken}`,
    '--no-report-events',
    '--timeout-request',
    '10000',
  ],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
);

process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
