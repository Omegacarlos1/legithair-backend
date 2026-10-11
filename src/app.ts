import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { Pool } from 'mysql2/promise';
import { AppError } from './http/errors.js';

interface AppDependencies { pool: Pool; logger: Logger; readinessTimeoutMs: number }

export function createApp({ pool, logger, readinessTimeoutMs }: AppDependencies): express.Express {
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
  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found')));
  const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
    void next;
    const known = error instanceof AppError;
    const status = known ? error.status : 500;
    req.log.error({ err: error }, 'Request failed');
    res.status(status).json({
      success: false,
      error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'An unexpected error occurred', ...(known && error.details !== undefined ? { details: error.details } : {}) },
      meta: { requestId: req.id }
    });
  };
  app.use(errorHandler);
  return app;
}
