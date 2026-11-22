import { Router, type RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { requireAnyRole, requireAuthentication } from '../auth/middleware.js';
import { AuthService } from '../auth/service.js';
import { AppError } from '../http/errors.js';
import { FinanceReadService } from './service.js';

const baseQuery = z.object({ page: z.coerce.number().int().min(1).max(100_000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), from: z.iso.date().optional(), to: z.iso.date().optional() });
const paymentQuery = baseQuery.extend({ status: z.enum(['initialization_pending', 'pending', 'succeeded', 'mismatch', 'late_success', 'failed']).optional(), orderId: z.uuid().optional() }).strict();
const transactionQuery = baseQuery.extend({ direction: z.enum(['credit', 'debit']).optional(), paymentId: z.uuid().optional() }).strict();
const reviewQuery = baseQuery.extend({ status: z.enum(['open', 'refund_pending', 'resolved']).optional() }).strict();
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };

export function createFinanceReadRouter(pool: Pool): Router {
  const router = Router();
  const auth = requireAuthentication(new AuthService(pool));
  const role = requireAnyRole(['admin', 'finance']);
  const service = new FinanceReadService(pool);
  router.get('/admin/payments', auth, role, asyncRoute(async (req, res) => {
    const query = paymentQuery.parse(req.query);
    validateRange(query.from, query.to);
    const result = await service.listPayments(query);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: { payments: result.payments }, meta: { requestId: req.id, pagination: result.pagination } });
  }));
  router.get('/admin/payments/:paymentId', auth, role, asyncRoute(async (req, res) => {
    const payment = await service.getPayment(z.uuid().parse(req.params.paymentId));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: { payment }, meta: { requestId: req.id } });
  }));
  router.get('/admin/transactions', auth, role, asyncRoute(async (req, res) => {
    const query = transactionQuery.parse(req.query);
    validateRange(query.from, query.to);
    const result = await service.listTransactions(query);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: { transactions: result.transactions }, meta: { requestId: req.id, pagination: result.pagination } });
  }));
  router.get('/admin/payment-review-cases', auth, role, asyncRoute(async (req, res) => {
    const query = reviewQuery.parse(req.query);
    validateRange(query.from, query.to);
    const result = await service.listReviewCases(query);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: { reviewCases: result.reviewCases }, meta: { requestId: req.id, pagination: result.pagination } });
  }));
  return router;
}

function validateRange(from?: string, to?: string): void { if (from && to && from > to) throw new AppError(400, 'INVALID_FINANCE_RANGE', 'to must be on or after from'); }
