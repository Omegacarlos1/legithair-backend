import { Router, type RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { requireAuthentication, requireRole } from '../auth/middleware.js';
import { AuthService } from '../auth/service.js';
import { MerchandisingService } from './service.js';

const optionalUrl = z.string().trim().max(500).refine((value) => value.startsWith('/') || /^https:\/\//i.test(value), 'Use an HTTPS URL or an application-relative path');
const nullableUrl = optionalUrl.nullable().optional();
const nullableDate = z.iso.datetime({ offset: true }).transform((value) => new Date(value)).nullable().optional();
const bannerSchema = z.object({
  title: z.string().trim().min(2).max(160), subtitle: z.string().trim().min(2).max(300).nullable().optional(), imageUrl: optionalUrl,
  targetUrl: nullableUrl, position: z.number().int().min(0).max(1000).optional(), status: z.enum(['draft', 'active', 'inactive']).optional(),
  startsAt: nullableDate, endsAt: nullableDate
}).strict();
const bannerUpdateSchema = bannerSchema.partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required');
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };

export function createMerchandisingRouter(pool: Pool): Router {
  const router = Router();
  const service = new MerchandisingService(pool);
  const authenticated = requireAuthentication(new AuthService(pool));
  router.get('/banners', asyncRoute(async (req, res) => {
    res.json({ success: true, data: { banners: await service.listPublic() }, meta: { requestId: req.id } });
  }));
  router.get('/admin/banners', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    res.json({ success: true, data: { banners: await service.listAdmin() }, meta: { requestId: req.id } });
  }));
  router.post('/admin/banners', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const banner = await service.create(req.authUser!.id, bannerSchema.parse(req.body));
    res.status(201).json({ success: true, data: { banner }, meta: { requestId: req.id } });
  }));
  router.patch('/admin/banners/:bannerId', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const banner = await service.update(req.authUser!.id, z.uuid().parse(req.params.bannerId), bannerUpdateSchema.parse(req.body));
    res.json({ success: true, data: { banner }, meta: { requestId: req.id } });
  }));
  return router;
}
