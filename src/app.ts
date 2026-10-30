import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { Pool } from 'mysql2/promise';
import { AppError } from './http/errors.js';
import { createAuthRouter } from './auth/router.js';
import { createSellerRouter } from './sellers/router.js';
import { createCatalogRouter } from './catalog/router.js';
import { createBasketRouter } from './baskets/router.js';
import { createOrderRouter } from './orders/router.js';
import type { OrderPolicy } from './orders/types.js';
import { createPaymentRouter } from './payments/router.js';
import { UnconfiguredPaymentProvider, type PaymentProvider } from './payments/provider.js';
import { createFulfilmentRouter } from './fulfilment/router.js';
import { FulfilmentService } from './fulfilment/service.js';
import type { FulfilmentPolicy } from './fulfilment/types.js';
import { UnconfiguredRefundProvider, type RefundProvider } from './refunds/provider.js';
import { UnconfiguredTransferProvider, type TransferProvider } from './payouts/provider.js';
import { EarningsPayoutService } from './payouts/service.js';
import { createPayoutRouter } from './payouts/router.js';
import type { EarningsPolicy } from './payouts/types.js';
import { createReviewRouter } from './reviews/router.js';
import { createMerchandisingRouter } from './merchandising/router.js';
import { createReportingRouter } from './reporting/router.js';
import { createSupportRouter } from './support/router.js';
import { createMarketingRouter } from './marketing/router.js';
import { ZodError } from 'zod';
import { configureTrustProxy, corsGuard, securityHeaders } from './http/security.js';

interface AppDependencies { pool: Pool; logger: Logger; readinessTimeoutMs: number; nodeEnv?: 'development' | 'test' | 'production'; trustProxyHops?: number; corsAllowedOrigins?: string[]; imageStorageRoot?: string; imageMaxBytes?: number; guestBasketTtlDays?: number; checkoutQuoteTtlSeconds?: number; orderPolicy?: OrderPolicy; paymentProvider?: PaymentProvider; refundProvider?: RefundProvider; transferProvider?: TransferProvider; earningsPolicy?: EarningsPolicy; fulfilmentPolicy?: FulfilmentPolicy; paystackWebhookSecret?: string; paystackCallbackUrl?: string; marketingUnsubscribeBaseUrl?: string }

export function createApp({ pool, logger, readinessTimeoutMs, nodeEnv = 'test', trustProxyHops = 0, corsAllowedOrigins = [], imageStorageRoot = 'storage/product-images', imageMaxBytes = 5 * 1024 * 1024, guestBasketTtlDays = 30, checkoutQuoteTtlSeconds = 900, orderPolicy = { codEnabled: false }, paymentProvider = new UnconfiguredPaymentProvider(), refundProvider = new UnconfiguredRefundProvider(), transferProvider = new UnconfiguredTransferProvider(), earningsPolicy = { payoutsEnabled: false }, fulfilmentPolicy = {}, paystackWebhookSecret, paystackCallbackUrl, marketingUnsubscribeBaseUrl }: AppDependencies): express.Express {
  const app = express();
  app.disable('x-powered-by');
  configureTrustProxy(app, trustProxyHops);
  app.use(securityHeaders(nodeEnv));
  app.use(pinoHttp({ logger, genReqId: (req, res) => {
    const supplied = req.headers['x-request-id'];
    const id = typeof supplied === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(supplied) ? supplied : randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  } }));
  app.use(corsGuard(corsAllowedOrigins));
  app.use(express.json({ limit: '1mb', verify: (req, _res, buffer) => { (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer); } }));
  const healthy: RequestHandler = (req, res) => res.status(200).json({
    success: true, data: { status: 'ok' }, meta: { requestId: req.id }
  });
  const ready: RequestHandler = async (req, res) => {
    try {
      await Promise.race([
        pool.query('SELECT 1'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Database readiness timed out')), readinessTimeoutMs))
      ]);
      res.status(200).json({ success: true, data: { status: 'ready', database: 'available' }, meta: { requestId: req.id } });
    } catch (error) {
      req.log.warn({ err: error }, 'Readiness check failed');
      res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Service is not ready' }, meta: { requestId: req.id } });
    }
  };

  app.get('/health', healthy);
  app.get('/ready', ready);
  app.get('/api/v1/health', healthy);
  app.get('/api/v1/ready', ready);
  app.use('/api/v1', createAuthRouter(pool));
  app.use('/api/v1', createSellerRouter(pool));
  app.use('/api/v1', createCatalogRouter(pool, imageStorageRoot, imageMaxBytes));
  app.use('/api/v1', createBasketRouter(pool, guestBasketTtlDays, checkoutQuoteTtlSeconds));
  app.use('/api/v1', createOrderRouter(pool, orderPolicy));
  const fulfilment = new FulfilmentService(pool, refundProvider, fulfilmentPolicy);
  const payouts = new EarningsPayoutService(pool, transferProvider, earningsPolicy);
  app.use('/api/v1', createPaymentRouter(pool, paymentProvider, paystackWebhookSecret, paystackCallbackUrl, (event, rawBody) => fulfilment.handleRefundWebhook(event, rawBody), (event, rawBody) => payouts.handleWebhook(event, rawBody)));
  app.use('/api/v1', createFulfilmentRouter(pool, fulfilment));
  app.use('/api/v1', createPayoutRouter(pool, payouts));
  app.use('/api/v1', createReviewRouter(pool));
  app.use('/api/v1', createMerchandisingRouter(pool));
  app.use('/api/v1', createReportingRouter(pool));
  app.use('/api/v1', createSupportRouter(pool));
  app.use('/api/v1', createMarketingRouter(pool, marketingUnsubscribeBaseUrl));
  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found')));
  const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
    void next;
    const validation = error instanceof ZodError;
    const known = error instanceof AppError;
    const bodyFailure = requestBodyFailure(error);
    const status = validation ? 400 : known ? error.status : bodyFailure?.status ?? 500;
    const code = validation ? 'VALIDATION_ERROR' : known ? error.code : bodyFailure?.code ?? 'INTERNAL_ERROR';
    if (status >= 500) req.log.error({ err: error }, 'Request failed');
    else req.log.warn({ status, code }, 'Request rejected');
    res.status(status).json({
      success: false,
      error: { code, message: validation ? 'Request validation failed' : known ? error.message : bodyFailure?.message ?? 'An unexpected error occurred', ...(validation ? { details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) } : known && error.details !== undefined ? { details: error.details } : {}) },
      meta: { requestId: req.id }
    });
  };
  app.use(errorHandler);
  return app;
}

function requestBodyFailure(error: unknown): { status: 400 | 413; code: string; message: string } | undefined {
  if (typeof error !== 'object' || error === null || !('type' in error)) return undefined;
  if (error.type === 'entity.parse.failed') return { status: 400, code: 'INVALID_JSON', message: 'Request body contains invalid JSON' };
  if (error.type === 'entity.too.large') return { status: 413, code: 'REQUEST_TOO_LARGE', message: 'Request body exceeds the allowed size' };
  return undefined;
}
