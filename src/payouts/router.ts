import { Router, type RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { AuthService } from '../auth/service.js';
import { requireAuthentication, requireRole } from '../auth/middleware.js';
import { AppError } from '../http/errors.js';
import { EarningsPayoutService } from './service.js';

const payoutSchema = z.object({ sellerId: z.uuid(), amountMinor: z.number().int().positive().safe() }).strict();
const recipientSchema = z.object({ providerRecipientCode: z.string().trim().min(3).max(100).regex(/^RCP_[A-Za-z0-9]+$/), accountName: z.string().trim().min(2).max(160), bankName: z.string().trim().min(2).max(120), accountLast4: z.string().regex(/^\d{4}$/) }).strict();
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };

export function createPayoutRouter(pool: Pool, service: EarningsPayoutService): Router {
  const router = Router();
  const authenticated = requireAuthentication(new AuthService(pool));
  router.get('/seller/earnings', authenticated, requireRole('seller'), asyncRoute(async (req, res) => {
    res.json({ success: true, data: { earnings: await service.getSellerEarnings(req.authUser!.id) }, meta: { requestId: req.id } });
  }));
  router.put('/admin/sellers/:sellerId/payout-recipient', authenticated, requireRole('finance'), asyncRoute(async (req, res) => {
    const recipient = await service.configureRecipient(req.authUser!.id, z.uuid().parse(req.params.sellerId), recipientSchema.parse(req.body));
    res.json({ success: true, data: { recipient }, meta: { requestId: req.id } });
  }));
  router.post('/admin/payouts', authenticated, requireRole('finance'), asyncRoute(async (req, res) => {
    const key = req.header('idempotency-key');
    if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required');
    const body = payoutSchema.parse(req.body);
    const result = await service.createPayout(req.authUser!.id, body.sellerId, body.amountMinor, key);
    res.status(result.idempotentReplay ? 200 : 202).json({ success: true, data: result, meta: { requestId: req.id } });
  }));
  router.get('/admin/payouts/:payoutId', authenticated, requireRole('finance'), asyncRoute(async (req, res) => {
    res.json({ success: true, data: { payout: await service.getPayout(z.uuid().parse(req.params.payoutId)) }, meta: { requestId: req.id } });
  }));
  router.post('/admin/payouts/:payoutId/reconcile', authenticated, requireRole('finance'), asyncRoute(async (req, res) => {
    z.object({}).strict().parse(req.body);
    res.json({ success: true, data: { payout: await service.reconcilePayout(z.uuid().parse(req.params.payoutId)) }, meta: { requestId: req.id } });
  }));
  return router;
}
