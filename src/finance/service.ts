import type { Pool, RowDataPacket } from 'mysql2/promise';
import { AppError } from '../http/errors.js';

interface CountRow extends RowDataPacket { total: number | string }
interface PaymentRow extends RowDataPacket {
  id: string; order_id: string; provider_reference: string; status: string; expected_amount_minor: number | string; currency: string;
  paid_at: Date | null; verified_at: Date | null; created_at: Date; updated_at: Date; order_status: string;
}
interface LedgerRow extends RowDataPacket {
  id: string; order_id: string; payment_id: string; entry_type: string; direction: string; amount_minor: number | string;
  currency: string; created_at: Date; payment_status: string;
}
interface ReviewRow extends RowDataPacket {
  id: string; order_id: string; payment_id: string; case_type: string; status: string; created_at: Date; resolved_at: Date | null;
}
type PageQuery = { page: number; limit: number; from?: string; to?: string };
type PaymentQuery = PageQuery & { status?: string; orderId?: string };
type LedgerQuery = PageQuery & { direction?: 'credit' | 'debit'; paymentId?: string };
type ReviewQuery = PageQuery & { status?: 'open' | 'refund_pending' | 'resolved' };

export class FinanceReadService {
  public constructor(private readonly pool: Pool) {}

  public async listPayments(query: PaymentQuery): Promise<{ payments: object[]; pagination: object }> {
    const { where, params } = filters('p.created_at', query);
    if (query.status) { where.push('p.status = ?'); params.push(query.status); }
    if (query.orderId) { where.push('p.order_id = ?'); params.push(query.orderId); }
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const [counts] = await this.pool.query<CountRow[]>(`SELECT COUNT(*) AS total FROM payments p${clause}`, params);
    const [rows] = await this.pool.query<PaymentRow[]>(`SELECT p.id, p.order_id, p.provider_reference, p.status, p.expected_amount_minor, p.currency, p.paid_at, p.verified_at, p.created_at, p.updated_at, o.status AS order_status FROM payments p JOIN orders o ON o.id = p.order_id${clause} ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`, [...params, query.limit, (query.page - 1) * query.limit]);
    return { payments: rows.map(paymentView), pagination: pagination(query, counts[0]) };
  }

  public async getPayment(id: string): Promise<object> {
    const [rows] = await this.pool.query<PaymentRow[]>('SELECT p.id, p.order_id, p.provider_reference, p.status, p.expected_amount_minor, p.currency, p.paid_at, p.verified_at, p.created_at, p.updated_at, o.status AS order_status FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = ?', [id]);
    if (!rows[0]) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    const [reviews] = await this.pool.query<ReviewRow[]>('SELECT id, order_id, payment_id, case_type, status, created_at, resolved_at FROM payment_review_cases WHERE payment_id = ? ORDER BY created_at, id', [id]);
    return { ...paymentView(rows[0]), reviewCases: reviews.map(reviewView) };
  }

  public async listTransactions(query: LedgerQuery): Promise<{ transactions: object[]; pagination: object }> {
    const { where, params } = filters('l.created_at', query);
    if (query.direction) { where.push('l.direction = ?'); params.push(query.direction); }
    if (query.paymentId) { where.push('l.payment_id = ?'); params.push(query.paymentId); }
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const [counts] = await this.pool.query<CountRow[]>(`SELECT COUNT(*) AS total FROM payment_ledger_entries l${clause}`, params);
    const [rows] = await this.pool.query<LedgerRow[]>(`SELECT l.id, l.order_id, l.payment_id, l.entry_type, l.direction, l.amount_minor, l.currency, l.created_at, p.status AS payment_status FROM payment_ledger_entries l JOIN payments p ON p.id = l.payment_id${clause} ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?`, [...params, query.limit, (query.page - 1) * query.limit]);
    return { transactions: rows.map((row) => ({ id: row.id, orderId: row.order_id, paymentId: row.payment_id, entryType: row.entry_type, direction: row.direction, amountMinor: String(row.amount_minor), currency: row.currency, paymentStatus: row.payment_status, createdAt: row.created_at.toISOString() })), pagination: pagination(query, counts[0]) };
  }

  public async listReviewCases(query: ReviewQuery): Promise<{ reviewCases: object[]; pagination: object }> {
    const { where, params } = filters('r.created_at', query);
    if (query.status) { where.push('r.status = ?'); params.push(query.status); }
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const [counts] = await this.pool.query<CountRow[]>(`SELECT COUNT(*) AS total FROM payment_review_cases r${clause}`, params);
    const [rows] = await this.pool.query<ReviewRow[]>(`SELECT r.id, r.order_id, r.payment_id, r.case_type, r.status, r.created_at, r.resolved_at FROM payment_review_cases r${clause} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`, [...params, query.limit, (query.page - 1) * query.limit]);
    return { reviewCases: rows.map(reviewView), pagination: pagination(query, counts[0]) };
  }
}

function filters(column: string, query: PageQuery): { where: string[]; params: string[] } {
  const where: string[] = []; const params: string[] = [];
  if (query.from) { where.push(`${column} >= ?`); params.push(`${query.from} 00:00:00.000`); }
  if (query.to) { const next = new Date(`${query.to}T00:00:00.000Z`); next.setUTCDate(next.getUTCDate() + 1); where.push(`${column} < ?`); params.push(next.toISOString().replace('T', ' ').replace('Z', '')); }
  return { where, params };
}
function pagination(query: PageQuery, row: CountRow | undefined): object { const total = Number(row?.total ?? 0); return { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) }; }
function paymentView(row: PaymentRow): object { return { id: row.id, orderId: row.order_id, reference: row.provider_reference, status: row.status, orderStatus: row.order_status, expectedAmountMinor: String(row.expected_amount_minor), currency: row.currency, paidAt: row.paid_at?.toISOString() ?? null, verifiedAt: row.verified_at?.toISOString() ?? null, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() }; }
function reviewView(row: ReviewRow): object { return { id: row.id, orderId: row.order_id, paymentId: row.payment_id, caseType: row.case_type, status: row.status, createdAt: row.created_at.toISOString(), resolvedAt: row.resolved_at?.toISOString() ?? null }; }
