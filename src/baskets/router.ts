import { Router, type Request, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { AuthService } from '../auth/service.js';
import { requireAuthentication, requireRole } from '../auth/middleware.js';
import { AppError } from '../http/errors.js';
import { BasketService } from './service.js';
import type { BasketOwner } from './types.js';

const money = z.number().int().nonnegative().max(9_000_000_000_000);
const token = z.string().min(32).max(200).regex(/^[A-Za-z0-9_-]+$/);
const itemSchema = z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(20) }).strict();
const addressSchema = z.object({ recipientName: z.string().trim().min(2).max(100), phone: z.string().trim().min(7).max(30), line1: z.string().trim().min(3).max(200), line2: z.string().trim().min(1).max(200).optional(), city: z.string().trim().min(2).max(100), state: z.string().trim().min(2).max(100), countryCode: z.string().length(2).toUpperCase().default('NG') }).strict();
const quoteSchema = z.discriminatedUnion('deliveryMethod', [
  z.object({ deliveryMethod: z.literal('delivery'), zoneId: z.uuid(), addressId: z.uuid().optional(), address: addressSchema.optional() }).strict(),
  z.object({ deliveryMethod: z.literal('pickup'), pickupLocationId: z.uuid() }).strict()
]);
const zoneUpdateSchema = z.object({ name: z.string().trim().min(2).max(100).optional(), coverage: z.array(z.string().trim().min(2).max(100)).min(1).max(100).optional(), feeMinor: money.optional(), minBusinessDays: z.number().int().min(0).max(30).optional(), maxBusinessDays: z.number().int().min(0).max(30).optional(), isActive: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');
const zoneCreateSchema = z.object({ code: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(50), name: z.string().trim().min(2).max(100), coverage: z.array(z.string().trim().min(2).max(100)).min(1).max(100), feeMinor: money, minBusinessDays: z.number().int().min(0).max(30), maxBusinessDays: z.number().int().min(0).max(30), isActive: z.boolean().default(true) }).strict();
const pickupSchema = z.object({ name: z.string().trim().min(2).max(100), addressLine: z.string().trim().min(5).max(250), city: z.string().trim().min(2).max(100), state: z.string().trim().min(2).max(100), feeMinor: money.default(0), minBusinessDays: z.number().int().min(0).max(30), maxBusinessDays: z.number().int().min(0).max(30), isActive: z.boolean().default(false) }).strict();
const pickupUpdateSchema = pickupSchema.partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required');
const rateSchema = z.object({ ngnMinorPerUsdMinor: z.number().int().min(1).max(9_000_000_000_000) }).strict();
const createGuestLimit = rateLimit({ windowMs: 60 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, handler: (req, res) => res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many guest basket requests; try again later' }, meta: { requestId: req.id } }) });
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };

export function createBasketRouter(pool: Pool, guestTtlDays: number, quoteTtlSeconds: number): Router {
  const router = Router();
  const auth = new AuthService(pool);
  const baskets = new BasketService(pool, guestTtlDays, quoteTtlSeconds);
  const authenticated = requireAuthentication(auth);

  const owner = async (req: Request): Promise<BasketOwner> => {
    const authorization = req.header('authorization');
    const guestToken = req.header('x-guest-basket-token');
    if (authorization && guestToken) throw new AppError(400, 'AMBIGUOUS_BASKET_OWNER', 'Use either customer authentication or a guest basket credential, not both');
    if (authorization) {
      if (!authorization.startsWith('Bearer ')) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required');
      const user = await auth.authenticate(authorization.slice(7));
      if (!user.roles.includes('customer')) throw new AppError(403, 'CUSTOMER_ROLE_REQUIRED', 'The customer role is required');
      req.authUser = user; req.accessToken = authorization.slice(7);
      return { kind: 'customer', userId: user.id };
    }
    if (!guestToken) throw new AppError(401, 'BASKET_CREDENTIAL_REQUIRED', 'Customer authentication or X-Guest-Basket-Token is required');
    return { kind: 'guest', token: token.parse(guestToken) };
  };

  router.post('/baskets/guest', createGuestLimit, asyncRoute(async (req, res) => {
    z.object({}).strict().parse(req.body);
    res.status(201).json({ success: true, data: await baskets.createGuestBasket(), meta: { requestId: req.id } });
  }));
  router.get('/baskets/current', asyncRoute(async (req, res) => {
    res.json({ success: true, data: { basket: await baskets.getBasket(await owner(req)) }, meta: { requestId: req.id } });
  }));
  router.post('/baskets/items', asyncRoute(async (req, res) => {
    const input = itemSchema.parse(req.body);
    res.status(201).json({ success: true, data: { basket: await baskets.setItem(await owner(req), input.productId, input.quantity) }, meta: { requestId: req.id } });
  }));
  router.delete('/baskets/items/:productId', asyncRoute(async (req, res) => {
    await baskets.removeItem(await owner(req), z.uuid().parse(req.params.productId));
    res.status(204).send();
  }));
  router.post('/baskets/refresh', asyncRoute(async (req, res) => {
    z.object({}).strict().parse(req.body);
    res.json({ success: true, data: { basket: await baskets.refreshPrices(await owner(req)) }, meta: { requestId: req.id } });
  }));
  router.post('/baskets/merge', authenticated, requireRole('customer'), asyncRoute(async (req, res) => {
    const guestToken = token.parse(req.header('x-guest-basket-token'));
    res.json({ success: true, data: { basket: await baskets.mergeGuestBasket(req.authUser!.id, guestToken) }, meta: { requestId: req.id } });
  }));

  router.get('/delivery-options', asyncRoute(async (req, res) => {
    res.json({ success: true, data: await baskets.listDeliveryOptions(), meta: { requestId: req.id } });
  }));
  router.patch('/admin/delivery-zones/:zoneId', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const result = await baskets.updateZone(req.authUser!.id, z.uuid().parse(req.params.zoneId), zoneUpdateSchema.parse(req.body));
    res.json({ success: true, data: { zone: result }, meta: { requestId: req.id } });
  }));
  router.post('/admin/delivery-zones', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const result = await baskets.createZone(req.authUser!.id, zoneCreateSchema.parse(req.body));
    res.status(201).json({ success: true, data: { zone: result }, meta: { requestId: req.id } });
  }));
  router.post('/admin/pickup-locations', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const result = await baskets.createPickup(req.authUser!.id, pickupSchema.parse(req.body));
    res.status(201).json({ success: true, data: { pickupLocation: result }, meta: { requestId: req.id } });
  }));
  router.patch('/admin/pickup-locations/:pickupLocationId', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const result = await baskets.updatePickup(req.authUser!.id, z.uuid().parse(req.params.pickupLocationId), pickupUpdateSchema.parse(req.body));
    res.json({ success: true, data: { pickupLocation: result }, meta: { requestId: req.id } });
  }));
  router.put('/admin/exchange-rates/usd', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const result = await baskets.setUsdRate(req.authUser!.id, rateSchema.parse(req.body).ngnMinorPerUsdMinor);
    res.json({ success: true, data: { rate: result }, meta: { requestId: req.id } });
  }));

  router.post('/checkout/quotes', asyncRoute(async (req, res) => {
    const key = idempotencyKey(req.header('idempotency-key'));
    const result = await baskets.createQuote(await owner(req), quoteSchema.parse(req.body), key);
    res.status(result.idempotentReplay ? 200 : 201).json({ success: true, data: result, meta: { requestId: req.id } });
  }));
  router.get('/checkout/quotes/:quoteId', asyncRoute(async (req, res) => {
    const quote = await baskets.getQuote(await owner(req), z.uuid().parse(req.params.quoteId));
    res.json({ success: true, data: { quote }, meta: { requestId: req.id } });
  }));
  return router;
}

function idempotencyKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required');
  return value;
}
