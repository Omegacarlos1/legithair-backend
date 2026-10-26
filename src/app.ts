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
import { ZodError } from 'zod';

interface AppDependencies { pool: Pool; logger: Logger; readinessTimeoutMs: number; imageStorageRoot?: string; imageMaxBytes?: number; guestBasketTtlDays?: number; checkoutQuoteTtlSeconds?: number; orderPolicy?: OrderPolicy }

export function createApp({ pool, logger, readinessTimeoutMs, imageStorageRoot = 'storage/product-images', imageMaxBytes = 5 * 1024 * 1024, guestBasketTtlDays = 30, checkoutQuoteTtlSeconds = 900, orderPolicy = { codEnabled: false } }: AppDependencies): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger, genReqId: (req, res) => {
    const supplied = req.headers['x-request-id'];
    const id = typeof supplied === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(supplied) ? supplied : randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  } }));
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
  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found')));
  const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
    void next;
    const validation = error instanceof ZodError;
    const known = error instanceof AppError;
    const status = validation ? 400 : known ? error.status : 500;
    req.log.error({ err: error }, 'Request failed');
    res.status(status).json({
      success: false,
      error: { code: validation ? 'VALIDATION_ERROR' : known ? error.code : 'INTERNAL_ERROR', message: validation ? 'Request validation failed' : known ? error.message : 'An unexpected error occurred', ...(validation ? { details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) } : known && error.details !== undefined ? { details: error.details } : {}) },
      meta: { requestId: req.id }
    });
  };
  app.use(errorHandler);
  return app;
}
