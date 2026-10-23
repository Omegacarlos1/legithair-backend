import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Pool } from 'mysql2/promise';
import { AuthService } from '../auth/service.js';
import { requireAuthentication, requireRole } from '../auth/middleware.js';
import { SellerService } from './service.js';

const sellerSchema = z.object({
  businessName: z.string().trim().min(2).max(150),
  phone: z.string().trim().min(7).max(30)
}).strict();
const approvalSchema = z.object({
  status: z.enum(['pending', 'approved', 'suspended']),
  reason: z.string().trim().min(3).max(500)
}).strict();
const emptySchema = z.object({}).strict();
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };

export function createSellerRouter(pool: Pool): Router {
  const router = Router();
  const auth = new AuthService(pool);
  const sellers = new SellerService(pool);
  const authenticated = requireAuthentication(auth);

  router.post('/sellers', authenticated, asyncRoute(async (req, res) => {
    const seller = await sellers.create(req.authUser!.id, sellerSchema.parse(req.body));
    res.status(201).json({ success: true, data: { seller }, meta: { requestId: req.id } });
  }));
  router.get('/sellers/me', authenticated, asyncRoute(async (req, res) => {
    res.json({ success: true, data: { seller: await sellers.getByUserId(req.authUser!.id) }, meta: { requestId: req.id } });
  }));
  router.post('/sellers/me/verification', authenticated, asyncRoute(async (req, res) => {
    emptySchema.parse(req.body);
    await sellers.requestIdentityVerification(req.authUser!.id);
    res.status(202).json({ success: true, data: { status: 'pending' }, meta: { requestId: req.id } });
  }));
  router.patch('/admin/sellers/:sellerId/status', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const sellerId = z.uuid().parse(req.params.sellerId);
    const body = approvalSchema.parse(req.body);
    const seller = await sellers.updateApprovalStatus(req.authUser!.id, sellerId, body.status, body.reason);
    res.json({ success: true, data: { seller }, meta: { requestId: req.id } });
  }));
  return router;
}
