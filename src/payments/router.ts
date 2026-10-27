import { Router, type Request, type RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { AuthService } from '../auth/service.js';
import { AppError } from '../http/errors.js';
import type { OrderAccess } from '../orders/types.js';
import { verifyPaystackSignature, type PaymentProvider } from './provider.js';
import { PaymentService, type PaystackWebhookEvent } from './service.js';

const credential = z.string().min(32).max(200).regex(/^[A-Za-z0-9_-]+$/);
const initializeSchema = z.object({ orderId: z.uuid(), email: z.email().max(320).optional() }).strict();
const verifySchema = z.object({ orderId: z.uuid(), reference: z.string().min(3).max(100).regex(/^[A-Za-z0-9.=-]+$/) }).strict();
const webhookEnvelopeSchema = z.object({ event: z.string().min(1).max(100), data: z.record(z.string(), z.unknown()) }).passthrough();
const webhookSchema = z.object({
  event: z.string().min(1).max(100),
  data: z.object({
    id: z.union([z.string().max(32), z.number().int().nonnegative()]).transform(String),
    status: z.string().max(50),
    reference: z.string().min(3).max(100).regex(/^[A-Za-z0-9.=-]+$/),
    amount: z.number().int().nonnegative(),
    currency: z.string().length(3),
    paid_at: z.string().nullable().optional(),
    paidAt: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).default({})
  }).passthrough()
}).passthrough();
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };

export function createPaymentRouter(pool: Pool, provider: PaymentProvider, webhookSecret?: string, callbackUrl?: string, refundWebhookHandler?: (event: { event: string; data: Record<string, unknown> }, rawBody: Buffer) => Promise<object>): Router {
  const router = Router();
  const auth = new AuthService(pool);
  const payments = new PaymentService(pool, provider, callbackUrl ? { callbackUrl } : {});
  const providerCalls = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, handler: (req, res) => { res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many payment requests; try again later' }, meta: { requestId: req.id } }); } });

  const access = async (req: Request): Promise<OrderAccess> => {
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

  router.post('/payments/initialize', providerCalls, asyncRoute(async (req, res) => {
    const input = initializeSchema.parse(req.body);
    const result = await payments.initialize(await access(req), input.orderId, input.email);
    res.status(result.created ? 201 : 200).json({ success: true, data: result, meta: { requestId: req.id } });
  }));

  router.post('/payments/verify', providerCalls, asyncRoute(async (req, res) => {
    const input = verifySchema.parse(req.body);
    const result = await payments.verify(await access(req), input.orderId, input.reference);
    res.json({ success: true, data: result, meta: { requestId: req.id } });
  }));

  router.post('/payments/webhooks/paystack', asyncRoute(async (req, res) => {
    if (!verifyPaystackSignature(req.rawBody ?? Buffer.alloc(0), req.header('x-paystack-signature'), webhookSecret)) {
      throw new AppError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Webhook signature is invalid');
    }
    const envelope = webhookEnvelopeSchema.parse(req.body);
    if (envelope.event.startsWith('refund.')) {
      if (!refundWebhookHandler) throw new AppError(503, 'REFUND_WEBHOOK_NOT_CONFIGURED', 'Refund webhook handling is not configured');
      const result = await refundWebhookHandler(envelope, req.rawBody!);
      res.json({ success: true, data: result, meta: { requestId: req.id } });
      return;
    }
    const parsed = webhookSchema.parse(req.body);
    const paidValue = parsed.data.paid_at ?? parsed.data.paidAt;
    const event: PaystackWebhookEvent = {
      event: parsed.event,
      data: {
        id: parsed.data.id,
        status: parsed.data.status,
        reference: parsed.data.reference,
        amount: parsed.data.amount,
        currency: parsed.data.currency,
        paidAt: paidValue && !Number.isNaN(Date.parse(paidValue)) ? new Date(paidValue) : null,
        metadata: parsed.data.metadata
      }
    };
    const result = await payments.handleWebhook(event, req.rawBody!);
    res.json({ success: true, data: result, meta: { requestId: req.id } });
  }));

  router.get('/orders/:orderId/receipt', asyncRoute(async (req, res) => {
    const orderId = z.uuid().parse(req.params.orderId);
    const receipt = await payments.getReceipt(await access(req), orderId);
    res.setHeader('content-disposition', `attachment; filename="legit-hair-receipt-${orderId}.json"`);
    res.json({ success: true, data: { receipt }, meta: { requestId: req.id } });
  }));

  return router;
}
