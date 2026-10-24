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
  IMAGE_MAX_BYTES: z.coerce.number().int().min(1024).max(20 * 1024 * 1024).default(5 * 1024 * 1024)
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
