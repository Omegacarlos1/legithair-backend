import { Router, type RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { requireAuthentication, requireRole } from '../auth/middleware.js';
import { AuthService } from '../auth/service.js';
import { MarketingService } from './service.js';

const preferenceSchema = z.object({ optedIn: z.boolean() }).strict();
const unsubscribeSchema = z.object({ token: z.string().min(32).max(200) }).strict();
const campaignSchema = z.object({ subject: z.string().trim().min(3).max(200).refine((value) => !/[\r\n]/.test(value), 'Subject cannot contain line breaks'), body: z.string().trim().min(10).max(10_000) }).strict();
const suppressionSchema = z.discriminatedUnion('suppressed', [
  z.object({ email: z.email(), suppressed: z.literal(true), reason: z.enum(['bounce', 'complaint', 'manual']).default('manual') }).strict(),
  z.object({ email: z.email(), suppressed: z.literal(false) }).strict()
]);
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };

export function createMarketingRouter(pool: Pool, unsubscribeBaseUrl?: string): Router {
  const router = Router();
  const auth = new AuthService(pool);
  const authenticated = requireAuthentication(auth);
  const service = new MarketingService(pool, unsubscribeBaseUrl);

  router.get('/me/marketing-preference', authenticated, requireRole('customer'), asyncRoute(async (req, res) => {
    res.json({ success: true, data: { preference: await service.getPreference(req.authUser!.id) }, meta: { requestId: req.id } });
  }));
  router.put('/me/marketing-preference', authenticated, requireRole('customer'), asyncRoute(async (req, res) => {
    const body = preferenceSchema.parse(req.body);
    res.json({ success: true, data: { preference: await service.setPreference(req.authUser!.id, body.optedIn) }, meta: { requestId: req.id } });
  }));
  router.get('/marketing/unsubscribe', asyncRoute(async (req, res) => {
    const token = z.string().min(32).max(200).parse(req.query.token);
    res.json({ success: true, data: await service.unsubscribe(token), meta: { requestId: req.id } });
  }));
  router.post('/marketing/unsubscribe', asyncRoute(async (req, res) => {
    const body = unsubscribeSchema.parse(req.body);
    res.json({ success: true, data: await service.unsubscribe(body.token), meta: { requestId: req.id } });
  }));
  router.put('/admin/marketing/suppressions', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const body = suppressionSchema.parse(req.body);
    const suppression = await service.setSuppression(req.authUser!.id, body);
    res.json({ success: true, data: { suppression }, meta: { requestId: req.id } });
  }));
  router.post('/admin/marketing/campaigns', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const result = await service.createCampaign(req.authUser!.id, campaignSchema.parse(req.body));
    res.status(201).json({ success: true, data: result, meta: { requestId: req.id } });
  }));
  router.get('/admin/marketing/campaigns/:campaignId/deliveries', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const deliveries = await service.listCampaignDeliveries(z.uuid().parse(req.params.campaignId));
    res.json({ success: true, data: { deliveries }, meta: { requestId: req.id } });
  }));
  return router;
}
