import { Router, type RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { AuthService } from '../auth/service.js';
import { requireAuthentication, requireRole } from '../auth/middleware.js';
import { AppError } from '../http/errors.js';
import { ReviewService } from './service.js';

const pageSchema = z.object({ page: z.coerce.number().int().min(1).max(100_000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();
const reviewSchema = z.object({ orderItemId: z.uuid(), rating: z.number().int().min(1).max(5), title: z.string().trim().min(2).max(160), body: z.string().trim().min(10).max(5000) }).strict();
const moderationListSchema = pageSchema.extend({ status: z.enum(['pending', 'published', 'rejected']).default('pending') });
const moderationSchema = z.object({ status: z.enum(['published', 'rejected']), reason: z.string().trim().min(3).max(500) }).strict();
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };

export function createReviewRouter(pool: Pool): Router {
  const router = Router();
  const service = new ReviewService(pool);
  const authenticated = requireAuthentication(new AuthService(pool));

  router.get('/products/:productId/reviews', asyncRoute(async (req, res) => {
    const result = await service.listPublic(z.uuid().parse(req.params.productId), pageSchema.parse(req.query));
    res.json({ success: true, data: { reviews: result.reviews, summary: result.summary }, meta: { requestId: req.id, pagination: result.pagination } });
  }));
  router.post('/reviews', authenticated, requireRole('customer'), asyncRoute(async (req, res) => {
    const result = await service.createReview(req.authUser!.id, reviewSchema.parse(req.body), idempotencyKey(req.header('idempotency-key')));
    res.status(result.idempotentReplay ? 200 : 201).json({ success: true, data: result, meta: { requestId: req.id } });
  }));
  router.get('/admin/reviews', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const query = moderationListSchema.parse(req.query);
    const result = await service.listForModeration(query.status, query);
    res.json({ success: true, data: { reviews: result.reviews }, meta: { requestId: req.id, pagination: result.pagination } });
  }));
  router.patch('/admin/reviews/:reviewId', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const body = moderationSchema.parse(req.body);
    const review = await service.moderate(req.authUser!.id, z.uuid().parse(req.params.reviewId), body.status, body.reason);
    res.json({ success: true, data: { review }, meta: { requestId: req.id } });
  }));
  return router;
}

function idempotencyKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required');
  return value;
}
