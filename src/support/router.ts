import { Router, type RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { requireAuthentication, requireAnyRole, requireRole } from '../auth/middleware.js';
import { AuthService } from '../auth/service.js';
import { SupportService } from './service.js';

const clientId = z.uuid();
const createThreadSchema = z.object({ subject: z.string().trim().min(3).max(160), message: z.string().trim().min(1).max(4000), clientId }).strict();
const createMessageSchema = z.object({ body: z.string().trim().min(1).max(4000), clientId }).strict();
const messagePageSchema = z.object({ afterMessageId: z.string().regex(/^\d+$/).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
const threadListSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
const updateThreadSchema = z.object({ status: z.enum(['open', 'closed']).optional(), assignedSupportUserId: z.uuid().nullable().optional() }).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };

export function createSupportRouter(pool: Pool, service = new SupportService(pool)): Router {
  const router = Router();
  const authenticated = requireAuthentication(new AuthService(pool));
  router.post('/support/threads', authenticated, requireRole('customer'), asyncRoute(async (req, res) => {
    const result = await service.createThread(req.authUser!, createThreadSchema.parse(req.body));
    res.status(result.idempotentReplay ? 200 : 201).json({ success: true, data: result, meta: { requestId: req.id } });
  }));
  router.get('/support/threads', authenticated, requireAnyRole(['customer', 'support', 'admin']), asyncRoute(async (req, res) => {
    const query = threadListSchema.parse(req.query);
    res.json({ success: true, data: { threads: await service.listThreads(req.authUser!, query.limit) }, meta: { requestId: req.id } });
  }));
  router.get('/support/threads/:threadId/messages', authenticated, requireAnyRole(['customer', 'support', 'admin']), asyncRoute(async (req, res) => {
    const result = await service.listMessages(req.authUser!, z.uuid().parse(req.params.threadId), messagePageSchema.parse(req.query));
    res.json({ success: true, data: { messages: result.messages }, meta: { requestId: req.id, nextAfterMessageId: result.nextAfterMessageId } });
  }));
  router.post('/support/threads/:threadId/messages', authenticated, requireAnyRole(['customer', 'support', 'admin']), asyncRoute(async (req, res) => {
    const result = await service.createMessage(req.authUser!, z.uuid().parse(req.params.threadId), createMessageSchema.parse(req.body));
    res.status(result.idempotentReplay ? 200 : 201).json({ success: true, data: result, meta: { requestId: req.id } });
  }));
  router.patch('/support/threads/:threadId', authenticated, requireAnyRole(['support', 'admin']), asyncRoute(async (req, res) => {
    const thread = await service.updateThread(req.authUser!, z.uuid().parse(req.params.threadId), updateThreadSchema.parse(req.body));
    res.json({ success: true, data: { thread }, meta: { requestId: req.id } });
  }));
  return router;
}
