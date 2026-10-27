import { Router, type Request, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { AuthService } from '../auth/service.js';
import { requireAuthentication, requireRole } from '../auth/middleware.js';
import { AppError } from '../http/errors.js';
import type { ReturnOwner, SuborderStatus } from './types.js';
import { FulfilmentService } from './service.js';

const credential = z.string().min(32).max(200).regex(/^[A-Za-z0-9_-]+$/);
const reason = z.string().trim().min(3).max(500);
const sellerTransitionSchema = z.object({ status: z.enum(['processing', 'shipped', 'ready_for_pickup']), reason: reason.optional() }).strict();
const adminTransitionSchema = z.object({ status: z.enum(['processing', 'shipped', 'ready_for_pickup', 'delivered', 'picked_up', 'cancelled']), reason: reason.optional() }).strict();
const cancelSchema = z.object({ reason }).strict();
const returnSchema = z.object({ items: z.array(z.object({ orderItemId: z.uuid(), quantity: z.number().int().min(1).max(20) }).strict()).min(1).max(50), reason }).strict();
const reviewSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), adminNote: reason, stockDisposition: z.enum(['restock', 'no_restock']) }).strict(),
  z.object({ action: z.literal('reject'), adminNote: reason }).strict()
]);
const codRecordSchema = z.object({ amountMinor: z.number().int().nonnegative().safe(), collectionReference: z.string().trim().min(3).max(190).regex(/^[A-Za-z0-9._:/-]+$/), collectedAt: z.iso.datetime() }).strict();
const codReviewSchema = z.object({ action: z.enum(['confirm', 'reject']), note: reason }).strict();
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };

export function createFulfilmentRouter(pool: Pool, fulfilment: FulfilmentService): Router {
  const router = Router();
  const auth = new AuthService(pool);
  const authenticated = requireAuthentication(auth);
  const providerCalls = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });

  const access = async (req: Request): Promise<ReturnOwner> => {
    const authorization = req.header('authorization');
    const trackingToken = req.header('x-order-tracking-token');
    if (authorization && trackingToken) throw new AppError(400, 'AMBIGUOUS_ORDER_ACCESS', 'Use either customer authentication or an order tracking credential, not both');
    if (authorization) {
      if (!authorization.startsWith('Bearer ')) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required');
      const user = await auth.authenticate(authorization.slice(7));
      if (!user.roles.includes('customer')) throw new AppError(403, 'CUSTOMER_ROLE_REQUIRED', 'The customer role is required');
      return { kind: 'customer', userId: user.id };
    }
    if (trackingToken) return { kind: 'guest', trackingToken: credential.parse(trackingToken) };
    throw new AppError(401, 'ORDER_ACCESS_REQUIRED', 'Customer authentication or X-Order-Tracking-Token is required');
  };

  router.patch('/seller/orders/:orderId/status', authenticated, requireRole('seller'), asyncRoute(async (req, res) => {
    const body = sellerTransitionSchema.parse(req.body);
    const progress = await fulfilment.transitionSeller(req.authUser!.id, z.uuid().parse(req.params.orderId), body.status as SuborderStatus, body.reason);
    res.json({ success: true, data: { fulfilment: progress }, meta: { requestId: req.id } });
  }));

  router.patch('/admin/orders/:orderId/suborders/:suborderId/status', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const body = adminTransitionSchema.parse(req.body);
    const progress = await fulfilment.transitionAdmin(req.authUser!.id, z.uuid().parse(req.params.orderId), z.uuid().parse(req.params.suborderId), body.status as SuborderStatus, body.reason);
    res.json({ success: true, data: { fulfilment: progress }, meta: { requestId: req.id } });
  }));

  router.get('/orders/:orderId/fulfilment', asyncRoute(async (req, res) => {
    const orderId = z.uuid().parse(req.params.orderId);
    await fulfilment.listReturns(await access(req), orderId);
    res.json({ success: true, data: { fulfilment: await fulfilment.orderProgress(orderId) }, meta: { requestId: req.id } });
  }));

  router.post('/orders/:orderId/cancel', asyncRoute(async (req, res) => {
    const orderId = z.uuid().parse(req.params.orderId);
    const body = cancelSchema.parse(req.body);
    const progress = await fulfilment.cancelOrder(await access(req), orderId, body.reason);
    res.json({ success: true, data: { fulfilment: progress }, meta: { requestId: req.id } });
  }));

  router.post('/orders/:orderId/returns', asyncRoute(async (req, res) => {
    const orderId = z.uuid().parse(req.params.orderId);
    const body = returnSchema.parse(req.body);
    const result = await fulfilment.requestReturn(await access(req), orderId, body.items, body.reason, idempotencyKey(req.header('idempotency-key')));
    res.status(result.idempotentReplay ? 200 : 201).json({ success: true, data: result, meta: { requestId: req.id } });
  }));

  router.get('/orders/:orderId/returns', asyncRoute(async (req, res) => {
    const orderId = z.uuid().parse(req.params.orderId);
    res.json({ success: true, data: { returns: await fulfilment.listReturns(await access(req), orderId) }, meta: { requestId: req.id } });
  }));

  router.patch('/admin/returns/:returnRequestId', authenticated, requireRole('admin'), providerCalls, asyncRoute(async (req, res) => {
    const body = reviewSchema.parse(req.body);
    const result = await fulfilment.reviewReturn(req.authUser!.id, z.uuid().parse(req.params.returnRequestId), body.action, body.adminNote, body.action === 'approve' ? body.stockDisposition : undefined);
    res.json({ success: true, data: { returnRequest: result }, meta: { requestId: req.id } });
  }));

  router.post('/admin/refunds/:refundId/reconcile', authenticated, requireRole('admin'), providerCalls, asyncRoute(async (req, res) => {
    z.object({}).strict().parse(req.body);
    const refund = await fulfilment.reconcileRefund(z.uuid().parse(req.params.refundId));
    res.json({ success: true, data: { refund }, meta: { requestId: req.id } });
  }));

  router.post('/admin/payment-review-cases/:caseId/refund', authenticated, requireRole('admin'), providerCalls, asyncRoute(async (req, res) => {
    z.object({}).strict().parse(req.body);
    const refund = await fulfilment.refundLatePayment(req.authUser!.id, z.uuid().parse(req.params.caseId));
    res.status(202).json({ success: true, data: { refund }, meta: { requestId: req.id } });
  }));

  router.post('/admin/orders/:orderId/cod-collection', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const body = codRecordSchema.parse(req.body);
    const result = await fulfilment.recordCodCollection(req.authUser!.id, z.uuid().parse(req.params.orderId), body.amountMinor, body.collectionReference, new Date(body.collectedAt), idempotencyKey(req.header('idempotency-key')));
    res.status(result.idempotentReplay ? 200 : 201).json({ success: true, data: result, meta: { requestId: req.id } });
  }));

  router.patch('/admin/cod-collections/:collectionId', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const body = codReviewSchema.parse(req.body);
    const collection = await fulfilment.reconcileCodCollection(req.authUser!.id, z.uuid().parse(req.params.collectionId), body.action, body.note);
    res.json({ success: true, data: { collection }, meta: { requestId: req.id } });
  }));

  return router;
}

function idempotencyKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required');
  return value;
}
