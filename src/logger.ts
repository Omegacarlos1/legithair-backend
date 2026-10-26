import pino, { type Logger } from 'pino';
import type { AppConfig } from './config.js';

export function createLogger(config: Pick<AppConfig, 'LOG_LEVEL'>): Logger {
  return pino({
    level: config.LOG_LEVEL,
    redact: {
      paths: ['password', '*.password', 'req.headers.authorization', 'req.headers.cookie', 'req.headers.x-guest-basket-token', 'req.headers.x-order-tracking-token', 'config.DATABASE_PASSWORD', 'config.ORDER_GUEST_TOKEN_SECRET'],
      censor: '[REDACTED]'
    }
  });
}
