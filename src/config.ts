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
  EMAIL_PROVIDER: z.enum(['fake', 'gmail']).default('fake'),
  EMAIL_FROM_NAME: z.string().trim().min(1).max(100).refine((value) => !/[\r\n]/.test(value)).default('Legit Hair'),
  GMAIL_USER: optionalEmail,
  GMAIL_APP_PASSWORD: optionalGmailAppPassword,
  EMAIL_WORKER_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(2000),
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
  PAYSTACK_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(10_000)
}).superRefine((config, context) => {
  if (config.EMAIL_PROVIDER !== 'gmail') return;
  if (!config.GMAIL_USER) context.addIssue({ code: 'custom', path: ['GMAIL_USER'], message: 'GMAIL_USER is required for Gmail delivery' });
  if (!config.GMAIL_APP_PASSWORD) context.addIssue({ code: 'custom', path: ['GMAIL_APP_PASSWORD'], message: 'A 16-character Gmail App Password is required' });
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
