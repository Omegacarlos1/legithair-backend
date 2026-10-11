import pino, { type Logger } from 'pino';
import type { AppConfig } from './config.js';

export function createLogger(config: Pick<AppConfig, 'LOG_LEVEL'>): Logger {
  return pino({
    level: config.LOG_LEVEL,
    redact: {
      paths: ['password', '*.password', 'req.headers.authorization', 'req.headers.cookie', 'config.DATABASE_PASSWORD'],
      censor: '[REDACTED]'
    }
  });
}
