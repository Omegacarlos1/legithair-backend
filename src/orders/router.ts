import { Router, type Request, type RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { AuthService } from '../auth/service.js';
import { AppError } from '../http/errors.js';
import { OrderService } from './service.js';
import type { OrderAccess, OrderOwner, OrderPolicy } from './types.js';

const credential = z.string().min(32).max(200).regex(/^[A-Za-z0-9_-]+$/);
const createSchema = z.object({ quoteId: z.uuid(), paymentMethod: z.enum(['paystack', 'cod']) }).strict();
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };

export function createOrderRouter(pool: Pool, policy: OrderPolicy): Router {
  const router = Router();
  const auth = new AuthService(pool);
  const orders = new OrderService(pool, policy);

  const authenticateCustomer = async (authorization: string): Promise<string> => {
    if (!authorization.startsWith('Bearer ')) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required');
    const user = await auth.authenticate(authorization.slice(7));
    if (!user.roles.includes('customer')) throw new AppError(403, 'CUSTOMER_ROLE_REQUIRED', 'The customer role is required');
    return user.id;
  };
  const createOwner = async (req: Request): Promise<OrderOwner> => {
    const authorization = req.header('authorization');
    const basketToken = req.header('x-guest-basket-token');
    if (authorization && basketToken) throw new AppError(400, 'AMBIGUOUS_ORDER_OWNER', 'Use either customer authentication or a guest basket credential, not both');
    if (authorization) return { kind: 'customer', userId: await authenticateCustomer(authorization) };
    if (basketToken) return { kind: 'guest', basketToken: credential.parse(basketToken) };
    throw new AppError(401, 'ORDER_OWNER_REQUIRED', 'Customer authentication or X-Guest-Basket-Token is required');
  };
  const readAccess = async (req: Request): Promise<OrderAccess> => {
    const authorization = req.header('authorization');
    const trackingToken = req.header('x-order-tracking-token');
    if (authorization && trackingToken) throw new AppError(400, 'AMBIGUOUS_ORDER_ACCESS', 'Use either customer authentication or an order tracking credential, not both');
    if (authorization) return { kind: 'customer', userId: await authenticateCustomer(authorization) };
    if (trackingToken) return { kind: 'guest', trackingToken: credential.parse(trackingToken) };
    throw new AppError(401, 'ORDER_ACCESS_REQUIRED', 'Customer authentication or X-Order-Tracking-Token is required');
  };

  router.post('/orders', asyncRoute(async (req, res) => {
    const input = createSchema.parse(req.body);
    const result = await orders.createOrder(await createOwner(req), input.quoteId, input.paymentMethod, idempotencyKey(req.header('idempotency-key')));
    res.status(result.idempotentReplay ? 200 : 201).json({ success: true, data: result, meta: { requestId: req.id } });
  }));
  router.get('/orders/:orderId', asyncRoute(async (req, res) => {
    const order = await orders.getOrder(await readAccess(req), z.uuid().parse(req.params.orderId));
    res.json({ success: true, data: { order }, meta: { requestId: req.id } });
  }));
  return router;
}

function idempotencyKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required');
  return value;
}
