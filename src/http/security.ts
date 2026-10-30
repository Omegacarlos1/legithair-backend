import type { Express, RequestHandler } from 'express';
import { AppError } from './errors.js';

export interface HttpSecurityOptions {
  nodeEnv: 'development' | 'test' | 'production';
  trustProxyHops: number;
  corsAllowedOrigins: string[];
}

export function configureTrustProxy(app: Express, hops: number): void {
  app.set('trust proxy', hops);
}

export function securityHeaders(nodeEnv: HttpSecurityOptions['nodeEnv']): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (nodeEnv === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

export function corsGuard(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    const origin = req.header('origin');
    if (!origin) { next(); return; }
    if (!allowed.has(origin)) { next(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed')); return; }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Idempotency-Key,X-Guest-Basket-Token,X-Order-Tracking-Token,X-Request-Id');
    res.appendHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') { res.status(204).send(); return; }
    next();
  };
}
