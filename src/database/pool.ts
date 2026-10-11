import mysql, { type Pool } from 'mysql2/promise';
import type { AppConfig } from '../config.js';

export function createDatabasePool(config: AppConfig): Pool {
  return mysql.createPool({
    host: config.DATABASE_HOST,
    port: config.DATABASE_PORT,
    user: config.DATABASE_USER,
    password: config.DATABASE_PASSWORD,
    database: config.DATABASE_NAME,
    connectionLimit: config.DATABASE_CONNECTION_LIMIT,
    enableKeepAlive: true,
    decimalNumbers: false
  });
}
