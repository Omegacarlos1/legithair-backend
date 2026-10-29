import { Router, type RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { requireAnyRole, requireAuthentication } from '../auth/middleware.js';
import { AuthService } from '../auth/service.js';
import { AppError } from '../http/errors.js';
import { renderCsv } from './csv.js';
import { ReportingService, type ReportName } from './service.js';

const reportSchema = z.enum(['sales', 'products', 'refunds', 'commissions', 'earnings', 'payouts']);
const querySchema = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional(), limit: z.coerce.number().int().min(1).max(5000).default(1000), format: z.enum(['json', 'csv']).default('json') }).strict();
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };

export function createReportingRouter(pool: Pool): Router {
  const router = Router();
  const authenticated = requireAuthentication(new AuthService(pool));
  const reports = new ReportingService(pool);
  router.get('/admin/reports/:report', authenticated, requireAnyRole(['admin', 'finance']), asyncRoute(async (req, res) => {
    const report = reportSchema.parse(req.params.report) as ReportName;
    const query = querySchema.parse(req.query);
    const from = query.from ? startOfDay(query.from) : undefined;
    const toExclusive = query.to ? nextDay(query.to) : undefined;
    if (from && toExclusive && from.getTime() >= toExclusive.getTime()) throw new AppError(400, 'INVALID_REPORT_RANGE', 'to must be on or after from');
    const result = await reports.run(report, { from, toExclusive, limit: query.limit });
    res.setHeader('Cache-Control', 'no-store');
    if (query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="legit-hair-${report}.csv"`);
      res.send(renderCsv(result.columns, result.rows));
      return;
    }
    res.json({ success: true, data: result, meta: { requestId: req.id } });
  }));
  return router;
}

function startOfDay(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
function nextDay(value: string): Date { const date = startOfDay(value); date.setUTCDate(date.getUTCDate() + 1); return date; }
