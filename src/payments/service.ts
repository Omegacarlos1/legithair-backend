import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { hashToken } from '../auth/token.js';
import { moneyValue } from '../baskets/money.js';
import { AppError } from '../http/errors.js';
import type { OrderAccess, OrderStatus } from '../orders/types.js';
import { PaymentProviderError, type PaymentProvider, type VerifiedPayment } from './provider.js';

interface OrderRow extends RowDataPacket {
  id: string; user_id: string | null; guest_tracking_token_hash: string | null; payment_method: string; status: OrderStatus;
  grand_total_minor: number | string; currency: string; reservation_expires_at: Date; customer_email: string | null;
}
interface PaymentRow extends RowDataPacket {
  id: string; order_id: string; provider_reference: string; provider_transaction_id: string | null; customer_email: string;
  expected_amount_minor: number | string; currency: string; status: PaymentStatus; authorization_url: string | null;
  access_code: string | null; paid_at: Date | null; verified_at: Date | null; last_error: string | null; created_at: Date; updated_at: Date;
}
interface ReservationRow extends RowDataPacket { id: string; product_id: string; quantity: number; status: 'active' | 'consumed' | 'released' }
interface ItemRow extends RowDataPacket { product_id: string; product_name: string; quantity: number; unit_price_minor: number | string; line_total_minor: number | string }
interface ProductIdRow extends RowDataPacket { id: string }
interface ReceiptRow extends RowDataPacket { id: string; receipt_number: string; order_id: string; payment_id: string; snapshot: string | object; issued_at: Date; user_id: string | null; guest_tracking_token_hash: string | null }
interface EventRow extends RowDataPacket { id: number; status: 'received' | 'processed' | 'rejected' }

type PaymentStatus = 'initialization_pending' | 'pending' | 'succeeded' | 'mismatch' | 'late_success' | 'failed';
type ReviewType = 'amount_mismatch' | 'currency_mismatch' | 'reference_mismatch' | 'order_association_mismatch' | 'late_payment';

export interface PaystackWebhookEvent {
  event: string;
  data: {
    id: string;
    status: string;
    reference: string;
    amount: number;
    currency: string;
    paidAt: Date | null;
    metadata: Record<string, unknown>;
  };
}

export interface PaymentOptions { callbackUrl?: string }

export class PaymentService {
  public constructor(private readonly pool: Pool, private readonly provider: PaymentProvider, private readonly options: PaymentOptions = {}) {}

  public async initialize(access: OrderAccess, orderId: string, guestEmail?: string): Promise<{ payment: object; created: boolean }> {
    const connection = await this.pool.getConnection();
    let payment: PaymentRow;
    let created = false;
    try {
      await connection.beginTransaction();
      const order = await this.lockOwnedOrder(connection, access, orderId);
      if (order.payment_method !== 'paystack') throw new AppError(409, 'PAYMENT_METHOD_NOT_PAYSTACK', 'This order is not payable through Paystack');
      const [existing] = await connection.query<PaymentRow[]>('SELECT * FROM payments WHERE order_id = ? FOR UPDATE', [orderId]);
      if (existing[0]) {
        payment = existing[0];
        if (guestEmail && payment.customer_email !== guestEmail.trim().toLowerCase()) throw new AppError(409, 'PAYMENT_EMAIL_MISMATCH', 'The payment was initialized with a different email address');
        if (payment.authorization_url || payment.status === 'succeeded' || payment.status === 'late_success') {
          await connection.commit();
          return { payment: paymentView(payment), created };
        }
        if (payment.status !== 'initialization_pending') throw new AppError(409, 'PAYMENT_ATTEMPT_NOT_INITIALIZABLE', 'The existing payment attempt cannot be initialized again');
        if (order.status !== 'awaiting_payment' || order.reservation_expires_at.getTime() <= Date.now()) throw new AppError(409, 'ORDER_RESERVATION_EXPIRED', 'The order reservation has expired');
        await connection.commit();
      } else {
        if (order.status !== 'awaiting_payment') throw new AppError(409, 'ORDER_NOT_AWAITING_PAYMENT', 'The order is not awaiting payment');
        if (order.reservation_expires_at.getTime() <= Date.now()) throw new AppError(409, 'ORDER_RESERVATION_EXPIRED', 'The order reservation has expired');
        if (moneyValue(order.grand_total_minor) <= 0) throw new AppError(409, 'PAYMENT_AMOUNT_INVALID', 'The order total must be greater than zero for Paystack');
        const email = order.customer_email ?? guestEmail?.trim().toLowerCase();
        if (!email) throw new AppError(400, 'GUEST_PAYMENT_EMAIL_REQUIRED', 'An email address is required to initialize a guest payment');
        const paymentId = randomUUID();
        const reference = `LH-${paymentId.replaceAll('-', '')}`;
        await connection.query(`INSERT INTO payments (id, order_id, provider_reference, customer_email, expected_amount_minor, currency)
          VALUES (?, ?, ?, ?, ?, ?)`, [paymentId, orderId, reference, email, order.grand_total_minor, order.currency]);
        const [rows] = await connection.query<PaymentRow[]>('SELECT * FROM payments WHERE id = ?', [paymentId]);
        payment = rows[0]!;
        created = true;
        await connection.commit();
      }
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }

    try {
      const initialized = await this.provider.initialize({
        email: payment.customer_email,
        amountMinor: moneyValue(payment.expected_amount_minor),
        currency: 'NGN',
        reference: payment.provider_reference,
        ...(this.options.callbackUrl ? { callbackUrl: this.options.callbackUrl } : {}),
        metadata: { order_id: payment.order_id, payment_id: payment.id }
      });
      if (initialized.reference !== payment.provider_reference) {
        await this.pool.query("UPDATE payments SET status = 'failed', last_error = 'provider_reference_mismatch' WHERE id = ?", [payment.id]);
        throw new AppError(502, 'PAYMENT_PROVIDER_REFERENCE_MISMATCH', 'Paystack returned an unexpected payment reference');
      }
      await this.pool.query("UPDATE payments SET status = 'pending', authorization_url = ?, access_code = ?, last_error = NULL WHERE id = ? AND status = 'initialization_pending'", [initialized.authorizationUrl, initialized.accessCode, payment.id]);
      payment = await this.paymentById(payment.id);
      return { payment: paymentView(payment), created };
    } catch (error) {
      if (error instanceof AppError) throw error;
      await this.recordProviderError(payment.id, error);
      throw providerAppError(error);
    }
  }

  public async verify(access: OrderAccess, orderId: string, suppliedReference: string): Promise<{ payment: object; outcome: string }> {
    await this.assertOwnedOrder(access, orderId);
    const payment = await this.paymentByOrder(orderId);
    if (payment.provider_reference !== suppliedReference) throw new AppError(409, 'PAYMENT_REFERENCE_MISMATCH', 'The supplied reference does not belong to this order');
    let result: VerifiedPayment;
    try { result = await this.provider.verify(payment.provider_reference); }
    catch (error) {
      await this.recordProviderError(payment.id, error);
      throw providerAppError(error);
    }
    const outcome = await this.applyVerification(result);
    if (outcome.endsWith('_mismatch')) throw new AppError(409, 'PAYMENT_VERIFICATION_MISMATCH', 'Verified payment details do not match the order', { outcome });
    return { payment: paymentView(await this.paymentById(payment.id)), outcome };
  }

  public async handleWebhook(event: PaystackWebhookEvent, rawBody: Buffer): Promise<{ duplicate: boolean; outcome: string }> {
    const eventKey = `${event.event}:${event.data.id || createHash('sha256').update(rawBody).digest('hex')}`;
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query<ResultSetHeader>(`INSERT IGNORE INTO payment_webhook_events (event_key, event_type, payload_sha256)
        VALUES (?, ?, ?)`, [eventKey, event.event, payloadHash]);
      const [events] = await connection.query<EventRow[]>('SELECT id, status FROM payment_webhook_events WHERE provider = ? AND event_key = ? FOR UPDATE', ['paystack', eventKey]);
      const stored = events[0]!;
      if (stored.status !== 'received') { await connection.commit(); return { duplicate: true, outcome: stored.status }; }
      if (event.event !== 'charge.success' || event.data.status !== 'success') {
        await connection.query("UPDATE payment_webhook_events SET status = 'processed', result_code = 'ignored_event', processed_at = NOW(3) WHERE id = ?", [stored.id]);
        await connection.commit();
        return { duplicate: false, outcome: 'ignored' };
      }
      const [payments] = await connection.query<PaymentRow[]>('SELECT * FROM payments WHERE provider_reference = ? FOR UPDATE', [event.data.reference]);
      const payment = payments[0];
      if (!payment) {
        await connection.query("UPDATE payment_webhook_events SET status = 'rejected', result_code = 'unknown_reference', processed_at = NOW(3) WHERE id = ?", [stored.id]);
        await connection.commit();
        return { duplicate: false, outcome: 'unknown_reference' };
      }
      await connection.query('UPDATE payment_webhook_events SET payment_id = ? WHERE id = ?', [payment.id, stored.id]);
      const result: VerifiedPayment = {
        status: event.data.status,
        reference: event.data.reference,
        amountMinor: event.data.amount,
        currency: event.data.currency,
        providerTransactionId: event.data.id,
        paidAt: event.data.paidAt,
        metadata: event.data.metadata
      };
      const outcome = await this.applyVerificationInTransaction(connection, payment, result);
      await connection.query('UPDATE payment_webhook_events SET status = ?, result_code = ?, processed_at = NOW(3) WHERE id = ?', [outcome.endsWith('_mismatch') ? 'rejected' : 'processed', outcome, stored.id]);
      await connection.commit();
      return { duplicate: false, outcome };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }

  public async getReceipt(access: OrderAccess, orderId: string): Promise<object> {
    const [rows] = await this.pool.query<ReceiptRow[]>(`SELECT r.*, o.user_id, o.guest_tracking_token_hash FROM paid_receipts r
      JOIN orders o ON o.id = r.order_id WHERE r.order_id = ?`, [orderId]);
    const receipt = rows[0];
    const allowed = receipt && (access.kind === 'customer' ? receipt.user_id === access.userId : receipt.guest_tracking_token_hash === hashToken(access.trackingToken));
    if (!allowed) throw new AppError(404, 'RECEIPT_NOT_FOUND', 'Receipt not found');
    return { id: receipt.id, receiptNumber: receipt.receipt_number, orderId: receipt.order_id, paymentId: receipt.payment_id, issuedAt: receipt.issued_at.toISOString(), ...jsonObject(receipt.snapshot) };
  }

  public async reconcilePending(limit = 100): Promise<{ checked: number; settled: number; late: number; failed: number }> {
    const [rows] = await this.pool.query<PaymentRow[]>("SELECT * FROM payments WHERE status IN ('initialization_pending', 'pending') ORDER BY updated_at LIMIT ?", [limit]);
    const counts = { checked: 0, settled: 0, late: 0, failed: 0 };
    for (const payment of rows) {
      counts.checked++;
      try {
        const result = await this.provider.verify(payment.provider_reference);
        const outcome = await this.applyVerification(result);
        if (outcome === 'succeeded' || outcome === 'already_succeeded') counts.settled++;
        if (outcome === 'late_payment' || outcome === 'already_late') counts.late++;
      } catch (error) {
        counts.failed++;
        await this.recordProviderError(payment.id, error);
      }
    }
    return counts;
  }

  private async applyVerification(result: VerifiedPayment): Promise<string> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<PaymentRow[]>('SELECT * FROM payments WHERE provider_reference = ? FOR UPDATE', [result.reference]);
      const payment = rows[0];
      if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
      const outcome = await this.applyVerificationInTransaction(connection, payment, result);
      await connection.commit();
      return outcome;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  private async applyVerificationInTransaction(connection: PoolConnection, payment: PaymentRow, result: VerifiedPayment): Promise<string> {
    if (payment.status === 'succeeded') return 'already_succeeded';
    if (payment.status === 'late_success') return 'already_late';
    const mismatch = verificationMismatch(payment, result);
    if (mismatch) {
      await connection.query("UPDATE payments SET status = 'mismatch', provider_transaction_id = ?, verified_at = NOW(3), last_error = ? WHERE id = ?", [result.providerTransactionId, mismatch, payment.id]);
      await this.insertReview(connection, payment, mismatch, { expectedAmountMinor: moneyValue(payment.expected_amount_minor), receivedAmountMinor: result.amountMinor, expectedCurrency: payment.currency, receivedCurrency: result.currency });
      return mismatch;
    }
    if (result.status !== 'success') {
      const status: PaymentStatus = ['failed', 'abandoned', 'reversed'].includes(result.status) ? 'failed' : 'pending';
      await connection.query('UPDATE payments SET status = ?, provider_transaction_id = ?, verified_at = NOW(3), last_error = NULL WHERE id = ?', [status, result.providerTransactionId, payment.id]);
      return status;
    }
    const [orders] = await connection.query<OrderRow[]>(`SELECT o.*, u.email AS customer_email FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = ? FOR UPDATE`, [payment.order_id]);
    const order = orders[0]!;
    const [reservations] = await connection.query<ReservationRow[]>('SELECT * FROM inventory_reservations WHERE order_id = ? ORDER BY product_id FOR UPDATE', [order.id]);
    const [clock] = await connection.query<Array<RowDataPacket & { database_now: Date }>>('SELECT NOW(3) AS database_now');
    const activeAndTimely = order.status === 'awaiting_payment' && order.reservation_expires_at.getTime() > clock[0]!.database_now.getTime() && reservations.length > 0 && reservations.every((reservation) => reservation.status === 'active');
    if (!activeAndTimely) {
      for (const reservation of reservations) {
        if (reservation.status !== 'active') continue;
        const [released] = await connection.query<ResultSetHeader>("UPDATE inventory_reservations SET status = 'released', released_at = NOW(3), release_reason = 'late_payment' WHERE id = ? AND status = 'active'", [reservation.id]);
        if (released.affectedRows === 1) await connection.query('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?', [reservation.quantity, reservation.product_id]);
      }
      if (order.status === 'awaiting_payment') {
        await connection.query("UPDATE orders SET status = 'reservation_expired' WHERE id = ?", [order.id]);
        await connection.query("INSERT INTO order_status_events (order_id, from_status, to_status, reason, actor_type) VALUES (?, 'awaiting_payment', 'reservation_expired', 'late_payment_after_reservation_expiry', 'provider')", [order.id]);
      }
      await connection.query("UPDATE payments SET status = 'late_success', provider_transaction_id = ?, paid_at = ?, verified_at = NOW(3), last_error = NULL WHERE id = ?", [result.providerTransactionId, result.paidAt, payment.id]);
      await connection.query(`INSERT IGNORE INTO payment_ledger_entries (id, order_id, payment_id, logical_key, entry_type, direction, amount_minor, currency, description)
        VALUES (?, ?, ?, ?, 'late_payment_received', 'credit', ?, ?, 'Payment received after inventory reservation was no longer valid')`, [randomUUID(), order.id, payment.id, `${payment.id}:late_payment_received`, payment.expected_amount_minor, payment.currency]);
      await this.insertReview(connection, payment, 'late_payment', { orderStatus: order.status, reservationExpiresAt: order.reservation_expires_at.toISOString(), resolution: 'controlled_refund_or_manual_review' });
      return 'late_payment';
    }
    await connection.query("UPDATE inventory_reservations SET status = 'consumed' WHERE order_id = ? AND status = 'active'", [order.id]);
    await connection.query("UPDATE orders SET status = 'paid' WHERE id = ?", [order.id]);
    await connection.query("INSERT INTO order_status_events (order_id, from_status, to_status, reason, actor_type) VALUES (?, 'awaiting_payment', 'paid', 'paystack_payment_verified', 'provider')", [order.id]);
    await connection.query("UPDATE payments SET status = 'succeeded', provider_transaction_id = ?, paid_at = ?, verified_at = NOW(3), last_error = NULL WHERE id = ?", [result.providerTransactionId, result.paidAt, payment.id]);
    await connection.query<ProductIdRow[]>('SELECT p.id FROM products p JOIN order_items oi ON oi.product_id = p.id WHERE oi.order_id = ? ORDER BY p.id FOR UPDATE', [order.id]);
    await connection.query(`UPDATE products p JOIN order_items oi ON oi.product_id = p.id
      SET p.paid_units_sold = p.paid_units_sold + oi.quantity WHERE oi.order_id = ?`, [order.id]);
    await connection.query(`INSERT INTO payment_ledger_entries (id, order_id, payment_id, logical_key, entry_type, direction, amount_minor, currency, description)
      VALUES (?, ?, ?, ?, 'payment_received', 'credit', ?, ?, 'Verified Paystack customer payment')`, [randomUUID(), order.id, payment.id, `${payment.id}:payment_received`, payment.expected_amount_minor, payment.currency]);
    const [items] = await connection.query<ItemRow[]>('SELECT product_id, product_name, quantity, unit_price_minor, line_total_minor FROM order_items WHERE order_id = ? ORDER BY id', [order.id]);
    const receiptId = randomUUID();
    const receiptNumber = `LH-${order.id.replaceAll('-', '').slice(0, 24).toUpperCase()}`;
    const snapshot = {
      currency: payment.currency,
      amountMinor: moneyValue(payment.expected_amount_minor),
      provider: 'paystack',
      reference: payment.provider_reference,
      providerTransactionId: result.providerTransactionId,
      paidAt: result.paidAt?.toISOString() ?? null,
      items: items.map((item) => ({ productId: item.product_id, productName: item.product_name, quantity: item.quantity, unitPriceMinor: moneyValue(item.unit_price_minor), lineTotalMinor: moneyValue(item.line_total_minor) }))
    };
    await connection.query('INSERT INTO paid_receipts (id, receipt_number, order_id, payment_id, snapshot) VALUES (?, ?, ?, ?, ?)', [receiptId, receiptNumber, order.id, payment.id, JSON.stringify(snapshot)]);
    await connection.query(`INSERT INTO durable_jobs (queue_name, job_type, deduplication_key, payload)
      VALUES ('email', 'send_paid_receipt', ?, ?)`, [`paid-receipt:${payment.id}`, JSON.stringify({ to: payment.customer_email, orderId: order.id, receiptNumber, amountMinor: moneyValue(payment.expected_amount_minor), currency: payment.currency })]);
    await connection.query("INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('order', ?, 'payment.confirmed', ?)", [order.id, JSON.stringify({ orderId: order.id, paymentId: payment.id, receiptId })]);
    return 'succeeded';
  }

  private async insertReview(connection: PoolConnection, payment: PaymentRow, type: ReviewType, details: object): Promise<void> {
    await connection.query(`INSERT INTO payment_review_cases (id, order_id, payment_id, case_type, details) VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE details = VALUES(details)`, [randomUUID(), payment.order_id, payment.id, type, JSON.stringify(details)]);
  }

  private async lockOwnedOrder(connection: PoolConnection, access: OrderAccess, orderId: string): Promise<OrderRow> {
    const [rows] = await connection.query<OrderRow[]>(`SELECT o.*, u.email AS customer_email FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = ? FOR UPDATE`, [orderId]);
    const order = rows[0];
    const allowed = order && (access.kind === 'customer' ? order.user_id === access.userId : order.guest_tracking_token_hash === hashToken(access.trackingToken));
    if (!allowed) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    return order;
  }

  private async assertOwnedOrder(access: OrderAccess, orderId: string): Promise<void> {
    const [rows] = await this.pool.query<OrderRow[]>('SELECT * FROM orders WHERE id = ?', [orderId]);
    const order = rows[0];
    const allowed = order && (access.kind === 'customer' ? order.user_id === access.userId : order.guest_tracking_token_hash === hashToken(access.trackingToken));
    if (!allowed) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }

  private async paymentByOrder(orderId: string): Promise<PaymentRow> {
    const [rows] = await this.pool.query<PaymentRow[]>('SELECT * FROM payments WHERE order_id = ?', [orderId]);
    if (!rows[0]) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    return rows[0];
  }

  private async paymentById(paymentId: string): Promise<PaymentRow> {
    const [rows] = await this.pool.query<PaymentRow[]>('SELECT * FROM payments WHERE id = ?', [paymentId]);
    if (!rows[0]) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    return rows[0];
  }

  private async recordProviderError(paymentId: string, error: unknown): Promise<void> {
    const message = error instanceof PaymentProviderError ? error.code : 'PAYMENT_PROVIDER_ERROR';
    await this.pool.query('UPDATE payments SET last_error = ? WHERE id = ?', [message, paymentId]);
  }
}

function verificationMismatch(payment: PaymentRow, result: VerifiedPayment): ReviewType | undefined {
  if (result.reference !== payment.provider_reference) return 'reference_mismatch';
  if (result.amountMinor !== moneyValue(payment.expected_amount_minor)) return 'amount_mismatch';
  if (result.currency !== payment.currency || result.currency !== 'NGN') return 'currency_mismatch';
  if (result.metadata.order_id !== payment.order_id || result.metadata.payment_id !== payment.id) return 'order_association_mismatch';
  return undefined;
}

function paymentView(payment: PaymentRow): object {
  return {
    id: payment.id,
    orderId: payment.order_id,
    provider: 'paystack',
    reference: payment.provider_reference,
    amountMinor: moneyValue(payment.expected_amount_minor),
    currency: payment.currency,
    status: payment.status,
    authorizationUrl: payment.authorization_url,
    accessCode: payment.access_code,
    paidAt: payment.paid_at?.toISOString() ?? null,
    verifiedAt: payment.verified_at?.toISOString() ?? null,
    createdAt: payment.created_at.toISOString(),
    updatedAt: payment.updated_at.toISOString()
  };
}

function providerAppError(error: unknown): AppError {
  if (error instanceof PaymentProviderError && error.code === 'PAYSTACK_NOT_CONFIGURED') return new AppError(503, 'PAYMENT_PROVIDER_NOT_CONFIGURED', 'Paystack payment processing is not configured');
  if (error instanceof PaymentProviderError && error.transient) return new AppError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Paystack is temporarily unavailable');
  return new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'Paystack could not process the request');
}

function jsonObject(value: string | object): Record<string, unknown> { return (typeof value === 'string' ? JSON.parse(value) : value) as Record<string, unknown>; }
