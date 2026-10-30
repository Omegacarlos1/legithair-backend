import type { Pool, RowDataPacket } from 'mysql2/promise';
import { AppError } from '../http/errors.js';

export type ReportName = 'sales' | 'products' | 'refunds' | 'commissions' | 'earnings' | 'payouts';
export interface ReportQuery { from?: Date; toExclusive?: Date; limit: number }
export interface ReportResult { report: ReportName; definition: string; currency: 'NGN'; columns: string[]; rows: Array<Record<string, unknown>>; totals: Record<string, string>; truncated: boolean }
interface GenericRow extends RowDataPacket { [key: string]: unknown }

const definitions: Record<ReportName, string> = {
  sales: 'Settled customer order totals before refunds. Gross sales include item subtotal plus company-retained delivery fees; Paystack requires succeeded payment and COD requires confirmed collection.',
  products: 'Paid units and item sales from settled orders. Units are gross paid units and are not reduced by later refunds.',
  refunds: 'Processed Paystack refunds only, separated into item and delivery amounts.',
  commissions: 'Order-item commission snapshots from settled orders, less commission reversals attached to processed refunds.',
  earnings: 'Seller ledger source earnings less refund reversals and recoverable obligations, with signed held, available, reserved, paid, and recoverable bucket movements.',
  payouts: 'Persisted payout requests by provider lifecycle status; successful amounts reconcile to payout_paid credits in the seller paid ledger bucket.'
};

export class ReportingService {
  public constructor(private readonly pool: Pool) {}

  public async run(report: ReportName, query: ReportQuery): Promise<ReportResult> {
    switch (report) {
      case 'sales': return this.sales(query);
      case 'products': return this.products(query);
      case 'refunds': return this.refunds(query);
      case 'commissions': return this.commissions(query);
      case 'earnings': return this.earnings(query);
      case 'payouts': return this.payouts(query);
      default: throw new AppError(404, 'REPORT_NOT_FOUND', 'Report not found');
    }
  }

  private async sales(query: ReportQuery): Promise<ReportResult> {
    const values: unknown[] = [];
    const date = dateFilter('COALESCE(pay.paid_at, cod.reconciled_at)', query, values);
    const [raw] = await this.pool.query<GenericRow[]>(`SELECT o.id AS orderId, o.payment_method AS paymentMethod, o.currency,
      o.items_subtotal_minor AS itemSalesMinor, o.delivery_total_minor AS deliveryFeesMinor, o.grand_total_minor AS grossSalesMinor,
      SUM(oi.quantity) AS unitsSold, COALESCE(pay.paid_at, cod.reconciled_at) AS settledAt
      FROM orders o JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN payments pay ON pay.order_id = o.id AND pay.status = 'succeeded'
      LEFT JOIN cod_collections cod ON cod.order_id = o.id AND cod.status = 'confirmed'
      WHERE (pay.id IS NOT NULL OR cod.id IS NOT NULL) ${date}
      GROUP BY o.id, o.payment_method, o.currency, o.items_subtotal_minor, o.delivery_total_minor, o.grand_total_minor, pay.paid_at, cod.reconciled_at
      ORDER BY settledAt DESC, o.id LIMIT ?`, [...values, query.limit + 1]);
    const { rows, truncated } = limited(raw, query.limit, (row) => ({ orderId: row.orderId, paymentMethod: row.paymentMethod, currency: row.currency, itemSalesMinor: decimal(row.itemSalesMinor), deliveryFeesMinor: decimal(row.deliveryFeesMinor), grossSalesMinor: decimal(row.grossSalesMinor), unitsSold: decimal(row.unitsSold), settledAt: iso(row.settledAt) }));
    return result('sales', ['orderId', 'paymentMethod', 'currency', 'itemSalesMinor', 'deliveryFeesMinor', 'grossSalesMinor', 'unitsSold', 'settledAt'], rows, { itemSalesMinor: sum(rows, 'itemSalesMinor'), deliveryFeesMinor: sum(rows, 'deliveryFeesMinor'), grossSalesMinor: sum(rows, 'grossSalesMinor'), unitsSold: sum(rows, 'unitsSold') }, truncated);
  }

  private async products(query: ReportQuery): Promise<ReportResult> {
    const values: unknown[] = [];
    const date = dateFilter('COALESCE(pay.paid_at, cod.reconciled_at)', query, values);
    const [raw] = await this.pool.query<GenericRow[]>(`SELECT p.id AS productId, p.name AS productName, p.paid_units_sold AS storedPaidUnits,
      SUM(oi.quantity) AS paidUnits, SUM(oi.line_total_minor) AS itemSalesMinor
      FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN orders o ON o.id = oi.order_id
      LEFT JOIN payments pay ON pay.order_id = o.id AND pay.status = 'succeeded'
      LEFT JOIN cod_collections cod ON cod.order_id = o.id AND cod.status = 'confirmed'
      WHERE (pay.id IS NOT NULL OR cod.id IS NOT NULL) ${date}
      GROUP BY p.id, p.name, p.paid_units_sold ORDER BY paidUnits DESC, p.id LIMIT ?`, [...values, query.limit + 1]);
    const { rows, truncated } = limited(raw, query.limit, (row) => ({ productId: row.productId, productName: row.productName, paidUnits: decimal(row.paidUnits), storedPaidUnits: decimal(row.storedPaidUnits), itemSalesMinor: decimal(row.itemSalesMinor) }));
    return result('products', ['productId', 'productName', 'paidUnits', 'storedPaidUnits', 'itemSalesMinor'], rows, { paidUnits: sum(rows, 'paidUnits'), itemSalesMinor: sum(rows, 'itemSalesMinor') }, truncated);
  }

  private async refunds(query: ReportQuery): Promise<ReportResult> {
    const values: unknown[] = [];
    const date = dateFilter('r.processed_at', query, values);
    const [raw] = await this.pool.query<GenericRow[]>(`SELECT r.id AS refundId, p.order_id AS orderId, r.currency, r.amount_minor AS refundMinor,
      r.delivery_refund_minor AS deliveryRefundMinor, (r.amount_minor - r.delivery_refund_minor) AS itemRefundMinor, r.processed_at AS processedAt
      FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE r.status = 'processed' ${date}
      ORDER BY r.processed_at DESC, r.id LIMIT ?`, [...values, query.limit + 1]);
    const { rows, truncated } = limited(raw, query.limit, (row) => ({ refundId: row.refundId, orderId: row.orderId, currency: row.currency, itemRefundMinor: decimal(row.itemRefundMinor), deliveryRefundMinor: decimal(row.deliveryRefundMinor), refundMinor: decimal(row.refundMinor), processedAt: iso(row.processedAt) }));
    return result('refunds', ['refundId', 'orderId', 'currency', 'itemRefundMinor', 'deliveryRefundMinor', 'refundMinor', 'processedAt'], rows, { itemRefundMinor: sum(rows, 'itemRefundMinor'), deliveryRefundMinor: sum(rows, 'deliveryRefundMinor'), refundMinor: sum(rows, 'refundMinor') }, truncated);
  }

  private async commissions(query: ReportQuery): Promise<ReportResult> {
    const grossValues: unknown[] = [];
    const grossDate = dateFilter('COALESCE(pay.paid_at, cod.reconciled_at)', query, grossValues);
    const [gross] = await this.pool.query<GenericRow[]>(`SELECT oi.seller_id AS sellerId, s.business_name AS sellerName, SUM(oi.commission_minor) AS amount
      FROM order_items oi JOIN sellers s ON s.id = oi.seller_id JOIN orders o ON o.id = oi.order_id
      LEFT JOIN payments pay ON pay.order_id = o.id AND pay.status = 'succeeded'
      LEFT JOIN cod_collections cod ON cod.order_id = o.id AND cod.status = 'confirmed'
      WHERE (pay.id IS NOT NULL OR cod.id IS NOT NULL) ${grossDate} GROUP BY oi.seller_id, s.business_name`, grossValues);
    const reversalValues: unknown[] = [];
    const reversalDate = dateFilter('r.processed_at', query, reversalValues);
    const [reversals] = await this.pool.query<GenericRow[]>(`SELECT a.seller_id AS sellerId, s.business_name AS sellerName, SUM(a.commission_reversal_minor) AS amount
      FROM seller_refund_adjustments a JOIN sellers s ON s.id = a.seller_id JOIN refunds r ON r.id = a.refund_id
      WHERE r.status = 'processed' ${reversalDate} GROUP BY a.seller_id, s.business_name`, reversalValues);
    const merged = mergeSellerAmounts(gross, reversals, 'grossCommissionMinor', 'reversedCommissionMinor').map((row) => ({ ...row, netCommissionMinor: (BigInt(String(row.grossCommissionMinor)) - BigInt(String(row.reversedCommissionMinor))).toString() }));
    const truncated = merged.length > query.limit;
    const rows = merged.slice(0, query.limit);
    return result('commissions', ['sellerId', 'sellerName', 'grossCommissionMinor', 'reversedCommissionMinor', 'netCommissionMinor'], rows, { grossCommissionMinor: sum(rows, 'grossCommissionMinor'), reversedCommissionMinor: sum(rows, 'reversedCommissionMinor'), netCommissionMinor: sum(rows, 'netCommissionMinor') }, truncated);
  }

  private async earnings(query: ReportQuery): Promise<ReportResult> {
    const values: unknown[] = [];
    const date = dateFilter('e.created_at', query, values);
    const [raw] = await this.pool.query<GenericRow[]>(`SELECT e.seller_id AS sellerId, s.business_name AS sellerName,
      SUM(CASE WHEN e.entry_type = 'earning_held' AND e.direction = 'credit' THEN e.amount_minor ELSE 0 END) AS earnedMinor,
      SUM(CASE WHEN e.entry_type = 'refund_reversal' AND e.direction = 'debit' THEN e.amount_minor ELSE 0 END) AS refundReversedMinor,
      SUM(CASE WHEN e.entry_type = 'refund_recoverable' AND e.direction = 'credit' THEN e.amount_minor ELSE 0 END) AS recoverableCreatedMinor,
      SUM(CASE WHEN e.bucket = 'held' THEN IF(e.direction='credit', e.amount_minor, -e.amount_minor) ELSE 0 END) AS heldMinor,
      SUM(CASE WHEN e.bucket = 'available' THEN IF(e.direction='credit', e.amount_minor, -e.amount_minor) ELSE 0 END) AS availableMinor,
      SUM(CASE WHEN e.bucket = 'reserved' THEN IF(e.direction='credit', e.amount_minor, -e.amount_minor) ELSE 0 END) AS reservedMinor,
      SUM(CASE WHEN e.bucket = 'paid' THEN IF(e.direction='credit', e.amount_minor, -e.amount_minor) ELSE 0 END) AS paidMinor,
      SUM(CASE WHEN e.bucket = 'recoverable' THEN IF(e.direction='credit', e.amount_minor, -e.amount_minor) ELSE 0 END) AS recoverableMinor
      FROM seller_ledger_entries e JOIN sellers s ON s.id = e.seller_id WHERE 1=1 ${date}
      GROUP BY e.seller_id, s.business_name ORDER BY e.seller_id LIMIT ?`, [...values, query.limit + 1]);
    const { rows, truncated } = limited(raw, query.limit, (row) => {
      const earned = BigInt(decimal(row.earnedMinor)); const reversed = BigInt(decimal(row.refundReversedMinor)); const recoverable = BigInt(decimal(row.recoverableCreatedMinor));
      return { sellerId: row.sellerId, sellerName: row.sellerName, earnedMinor: earned.toString(), refundReversedMinor: reversed.toString(), recoverableCreatedMinor: recoverable.toString(), netEarnedMinor: (earned - reversed - recoverable).toString(), heldMinor: decimal(row.heldMinor), availableMinor: decimal(row.availableMinor), reservedMinor: decimal(row.reservedMinor), paidMinor: decimal(row.paidMinor), recoverableMinor: decimal(row.recoverableMinor) };
    });
    return result('earnings', ['sellerId', 'sellerName', 'earnedMinor', 'refundReversedMinor', 'recoverableCreatedMinor', 'netEarnedMinor', 'heldMinor', 'availableMinor', 'reservedMinor', 'paidMinor', 'recoverableMinor'], rows, { earnedMinor: sum(rows, 'earnedMinor'), refundReversedMinor: sum(rows, 'refundReversedMinor'), recoverableCreatedMinor: sum(rows, 'recoverableCreatedMinor'), netEarnedMinor: sum(rows, 'netEarnedMinor') }, truncated);
  }

  private async payouts(query: ReportQuery): Promise<ReportResult> {
    const values: unknown[] = [];
    const date = dateFilter('p.created_at', query, values);
    const [raw] = await this.pool.query<GenericRow[]>(`SELECT p.id AS payoutId, p.seller_id AS sellerId, s.business_name AS sellerName, p.amount_minor AS amountMinor,
      p.currency, p.status, p.provider_reference AS providerReference, p.created_at AS createdAt, p.concluded_at AS concludedAt,
      COALESCE((SELECT SUM(IF(e.direction='credit', e.amount_minor, -e.amount_minor)) FROM seller_ledger_entries e WHERE e.payout_id = p.id AND e.bucket = 'paid'), 0) AS ledgerPaidMinor
      FROM payouts p JOIN sellers s ON s.id = p.seller_id WHERE 1=1 ${date} ORDER BY p.created_at DESC, p.id LIMIT ?`, [...values, query.limit + 1]);
    const { rows, truncated } = limited(raw, query.limit, (row) => ({ payoutId: row.payoutId, sellerId: row.sellerId, sellerName: row.sellerName, amountMinor: decimal(row.amountMinor), currency: row.currency, status: row.status, providerReference: row.providerReference, ledgerPaidMinor: decimal(row.ledgerPaidMinor), createdAt: iso(row.createdAt), concludedAt: iso(row.concludedAt) }));
    const successful = rows.filter((row) => row.status === 'success');
    return result('payouts', ['payoutId', 'sellerId', 'sellerName', 'amountMinor', 'currency', 'status', 'providerReference', 'ledgerPaidMinor', 'createdAt', 'concludedAt'], rows, { requestedMinor: sum(rows, 'amountMinor'), successfulMinor: sum(successful, 'amountMinor'), ledgerPaidMinor: sum(rows, 'ledgerPaidMinor') }, truncated);
  }
}

function result(report: ReportName, columns: string[], rows: Array<Record<string, unknown>>, totals: Record<string, string>, truncated: boolean): ReportResult {
  return { report, definition: definitions[report], currency: 'NGN', columns, rows, totals, truncated };
}
function dateFilter(column: string, query: ReportQuery, values: unknown[]): string {
  let sql = '';
  if (query.from) { sql += ` AND ${column} >= ?`; values.push(query.from); }
  if (query.toExclusive) { sql += ` AND ${column} < ?`; values.push(query.toExclusive); }
  return sql;
}
function decimal(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value).toString();
  throw new AppError(500, 'UNSAFE_REPORT_VALUE', 'A report aggregate could not be represented safely');
}
function iso(value: unknown): string | null { return value instanceof Date ? value.toISOString() : value === null || value === undefined ? null : new Date(String(value)).toISOString(); }
function sum(rows: Array<Record<string, unknown>>, field: string): string { return rows.reduce((total, row) => total + BigInt(String(row[field] ?? '0')), 0n).toString(); }
function limited(rows: GenericRow[], limit: number, map: (row: GenericRow) => Record<string, unknown>): { rows: Array<Record<string, unknown>>; truncated: boolean } { return { rows: rows.slice(0, limit).map(map), truncated: rows.length > limit }; }
function mergeSellerAmounts(gross: GenericRow[], reversals: GenericRow[], grossKey: string, reversalKey: string): Array<Record<string, unknown>> {
  const values = new Map<string, Record<string, unknown>>();
  for (const row of gross) values.set(String(row.sellerId), { sellerId: row.sellerId, sellerName: row.sellerName, [grossKey]: decimal(row.amount), [reversalKey]: '0' });
  for (const row of reversals) {
    const key = String(row.sellerId); const current = values.get(key) ?? { sellerId: row.sellerId, sellerName: row.sellerName, [grossKey]: '0', [reversalKey]: '0' };
    current[reversalKey] = decimal(row.amount); values.set(key, current);
  }
  return [...values.values()].sort((left, right) => String(left.sellerId).localeCompare(String(right.sellerId)));
}
