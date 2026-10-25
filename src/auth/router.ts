import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Pool } from 'mysql2/promise';
import { AppError } from '../http/errors.js';
import { AddressService } from './addresses.js';
import { requireAuthentication } from './middleware.js';
import { AuthService } from './service.js';

const password = z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/);
const registerSchema = z.object({ email: z.email().max(320), password, displayName: z.string().trim().min(2).max(100) }).strict();
const loginSchema = z.object({ email: z.email(), password: z.string().min(1).max(128) }).strict();
const tokenSchema = z.object({ token: z.string().min(32).max(200) }).strict();
const resetSchema = z.object({ token: z.string().min(32).max(200), password }).strict();
const addressSchema = z.object({ label: z.string().trim().min(1).max(50), recipientName: z.string().trim().min(2).max(100), phone: z.string().trim().min(7).max(30), line1: z.string().trim().min(3).max(200), line2: z.string().trim().max(200).optional(), city: z.string().trim().min(2).max(100), state: z.string().trim().min(2).max(100), countryCode: z.string().length(2).toUpperCase().default('NG'), isDefault: z.boolean().default(false) }).strict();
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };

export function createAuthRouter(pool: Pool): Router {
  const router = Router(); const auth = new AuthService(pool); const addresses = new AddressService(pool); const required = requireAuthentication(auth);
  const sensitive = rateLimit({ windowMs: 15 * 60_000, limit: 50, standardHeaders: 'draft-8', legacyHeaders: false, handler: (req, res) => { res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests; try again later' }, meta: { requestId: req.id } }); } });
  router.post('/auth/register', sensitive, asyncRoute(async (req, res) => { const result = await auth.register(registerSchema.parse(req.body)); res.status(201).json({ success: true, data: { ...result, message: 'Registration successful. Check your email to verify your address.' }, meta: { requestId: req.id } }); }));
  router.post('/auth/resend-verification', sensitive, asyncRoute(async (req, res) => { const email = z.object({ email: z.email() }).strict().parse(req.body).email; await auth.requestEmailVerification(email); res.status(202).json({ success: true, data: { message: 'If the account exists and is not verified, a verification email has been queued.' }, meta: { requestId: req.id } }); }));
  router.post('/auth/verify-email', sensitive, asyncRoute(async (req, res) => { await auth.verifyEmail(tokenSchema.parse(req.body).token); res.json({ success: true, data: { verified: true }, meta: { requestId: req.id } }); }));
  router.post('/auth/login', sensitive, asyncRoute(async (req, res) => { const body = loginSchema.parse(req.body); const result = await auth.login(body.email, body.password); res.json({ success: true, data: result, meta: { requestId: req.id } }); }));
  router.post('/auth/refresh', sensitive, asyncRoute(async (req, res) => { const tokens = await auth.refresh(tokenSchema.parse(req.body).token); res.json({ success: true, data: { tokens }, meta: { requestId: req.id } }); }));
  router.post('/auth/logout', required, asyncRoute(async (req, res) => { await auth.logout(req.accessToken!); res.status(204).send(); }));
  router.post('/auth/forgot-password', sensitive, asyncRoute(async (req, res) => { const email = z.object({ email: z.email() }).strict().parse(req.body).email; await auth.requestPasswordReset(email); res.status(202).json({ success: true, data: { message: 'If the account exists, reset instructions have been queued.' }, meta: { requestId: req.id } }); }));
  router.post('/auth/reset-password', sensitive, asyncRoute(async (req, res) => { const body = resetSchema.parse(req.body); await auth.resetPassword(body.token, body.password); res.json({ success: true, data: { reset: true }, meta: { requestId: req.id } }); }));
  router.get('/me', required, (req, res) => res.json({ success: true, data: { user: req.authUser }, meta: { requestId: req.id } }));
  router.get('/me/addresses', required, asyncRoute(async (req, res) => { res.json({ success: true, data: { addresses: await addresses.list(req.authUser!.id) }, meta: { requestId: req.id } }); }));
  router.post('/me/addresses', required, asyncRoute(async (req, res) => { const result = await addresses.create(req.authUser!.id, addressSchema.parse(req.body)); res.status(201).json({ success: true, data: result, meta: { requestId: req.id } }); }));
  router.get('/users/:userId/addresses', required, asyncRoute(async (req, res) => { const userId = z.uuid().parse(req.params.userId); if (req.authUser!.id !== userId && !req.authUser!.roles.includes('admin')) throw new AppError(403, 'FORBIDDEN', 'You cannot access another customer’s addresses'); res.json({ success: true, data: { addresses: await addresses.list(userId) }, meta: { requestId: req.id } }); }));
  return router;
}
