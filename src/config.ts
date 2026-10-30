import 'dotenv/config';
import { z } from 'zod';

const optionalEmail = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.email().optional()
);
const optionalGmailAppPassword = z.preprocess(
  (value) => typeof value === 'string' ? value.replace(/\s/g, '') || undefined : value,
  z.string().length(16).optional()
);
const optionalNumber = (minimum: number, maximum: number): z.ZodType<number | undefined> => z.preprocess(
  (value) => value === '' || value === undefined ? undefined : value,
  z.coerce.number().int().min(minimum).max(maximum).optional()
);
const corsOrigins = z.string().default('').transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
  .refine((origins) => origins.length <= 20 && origins.every(isExactHttpOrigin), 'CORS origins must be exact HTTP(S) origins');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_HOST: z.string().min(1),
  DATABASE_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DATABASE_USER: z.string().min(1),
  DATABASE_PASSWORD: z.string(),
  DATABASE_NAME: z.string().regex(/^[A-Za-z0-9_]+$/),
  DATABASE_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  READINESS_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(1500),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  CORS_ALLOWED_ORIGINS: corsOrigins,
  EMAIL_PROVIDER: z.enum(['fake', 'gmail']).default('fake'),
  EMAIL_FROM_NAME: z.string().trim().min(1).max(100).refine((value) => !/[\r\n]/.test(value)).default('Legit Hair'),
  GMAIL_USER: optionalEmail,
  GMAIL_APP_PASSWORD: optionalGmailAppPassword,
  EMAIL_WORKER_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(2000),
  EMAIL_JOB_LOCK_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(3600).default(300),
  MARKETING_UNSUBSCRIBE_BASE_URL: z.preprocess((value) => value === '' ? undefined : value, z.url().optional()),
  REALTIME_OUTBOX_POLL_MS: z.coerce.number().int().min(50).max(60_000).default(250),
  OUTBOX_LOCK_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(3600).default(30),
  OPS_MAX_PENDING_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  IMAGE_STORAGE_ROOT: z.string().trim().min(1).default('storage/product-images'),
  IMAGE_MAX_BYTES: z.coerce.number().int().min(1024).max(20 * 1024 * 1024).default(5 * 1024 * 1024),
  GUEST_BASKET_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  CHECKOUT_QUOTE_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  ORDER_RESERVATION_TTL_SECONDS: optionalNumber(60, 604800),
  ORDER_COMMISSION_BASIS: z.preprocess((value) => value === '' ? undefined : value, z.enum(['line_item_gross']).optional()),
  ORDER_COMMISSION_RATE_BPS: optionalNumber(0, 10000),
  COD_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  ORDER_GUEST_TOKEN_SECRET: z.preprocess((value) => value === '' ? undefined : value, z.string().min(32).optional()),
  PAYSTACK_SECRET_KEY: z.preprocess((value) => value === '' ? undefined : value, z.string().regex(/^sk_(test|live)_[A-Za-z0-9]+$/).min(20).optional()),
  PAYSTACK_BASE_URL: z.url().default('https://api.paystack.co'),
  PAYSTACK_CALLBACK_URL: z.preprocess((value) => value === '' ? undefined : value, z.url().optional()),
  PAYSTACK_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(10_000),
  RETURN_WINDOW_DAYS: optionalNumber(1, 365),
  REFUND_DELIVERY_MODE: z.preprocess((value) => value === '' ? undefined : value, z.enum(['never', 'full_order']).optional()),
  EARNINGS_HOLD_DAYS: optionalNumber(0, 365),
  PAYOUTS_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true')
}).superRefine((config, context) => {
  if (config.EMAIL_PROVIDER === 'gmail') {
    if (!config.GMAIL_USER) context.addIssue({ code: 'custom', path: ['GMAIL_USER'], message: 'GMAIL_USER is required for Gmail delivery' });
    if (!config.GMAIL_APP_PASSWORD) context.addIssue({ code: 'custom', path: ['GMAIL_APP_PASSWORD'], message: 'A 16-character Gmail App Password is required' });
  }
  if (config.NODE_ENV !== 'production') return;
  if (!config.DATABASE_PASSWORD) context.addIssue({ code: 'custom', path: ['DATABASE_PASSWORD'], message: 'A database password is required in production' });
  if (!config.CORS_ALLOWED_ORIGINS.length) context.addIssue({ code: 'custom', path: ['CORS_ALLOWED_ORIGINS'], message: 'At least one frontend origin is required in production' });
  if (config.EMAIL_PROVIDER === 'fake') context.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'The fake email provider is not allowed in production' });
  if (config.PAYSTACK_CALLBACK_URL && !config.PAYSTACK_CALLBACK_URL.startsWith('https://')) context.addIssue({ code: 'custom', path: ['PAYSTACK_CALLBACK_URL'], message: 'The production callback URL must use HTTPS' });
  if (config.MARKETING_UNSUBSCRIBE_BASE_URL && !config.MARKETING_UNSUBSCRIBE_BASE_URL.startsWith('https://')) context.addIssue({ code: 'custom', path: ['MARKETING_UNSUBSCRIBE_BASE_URL'], message: 'The production unsubscribe URL must use HTTPS' });
  if (config.PAYSTACK_SECRET_KEY?.startsWith('sk_live_') && config.PAYSTACK_BASE_URL !== 'https://api.paystack.co') context.addIssue({ code: 'custom', path: ['PAYSTACK_BASE_URL'], message: 'Live Paystack credentials require the official HTTPS API origin' });
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(environment);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid application configuration: ${fields}`);
  }
  return parsed.data;
}

function isExactHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value && !url.username && !url.password;
  } catch { return false; }
}
