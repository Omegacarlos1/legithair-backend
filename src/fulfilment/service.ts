import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { hashToken } from '../auth/token.js';
import { addMoney, moneyValue, multiplyMoney } from '../baskets/money.js';
import { AppError } from '../http/errors.js';
import { PaymentProviderError } from '../payments/provider.js';
import type { ProviderRefund, RefundProvider } from '../refunds/provider.js';
import type { FulfilmentPolicy, ReturnItemInput, ReturnOwner, SuborderStatus } from './types.js';

interface OrderRow extends RowDataPacket {
  id: string; user_id: string | null; guest_tracking_token_hash: string | null; payment_method: 'paystack' | 'cod'; status: string;
  delivery_method: 'delivery' | 'pickup'; destination_snapshot: string | object | null; grand_total_minor: number | string; delivery_total_minor: number | string; currency: string;
}
interface SuborderRow extends RowDataPacket { id: string; order_id: string; seller_id: string; status: SuborderStatus; fulfilled_at: Date | null; stock_restored_at: Date | null }
interface SellerRow extends RowDataPacket { id: string }
interface ItemRow extends RowDataPacket {
  id: string; order_id: string; suborder_id: string; seller_id: string; product_id: string; quantity: number;
  unit_price_minor: number | string; line_total_minor: number | string; commission_minor: number | string;
}
interface ReservationRow extends RowDataPacket { id: string; order_item_id: string; product_id: string; quantity: number; status: 'active' | 'consumed' | 'released' }
interface ReturnRow extends RowDataPacket {
  id: string; order_id: string; idempotency_key: string; request_hash: string; reason: string; status: string;
  requested_by_user_id: string | null; reviewed_by: string | null; admin_note: string | null; created_at: Date; updated_at: Date;
}
interface ReturnItemRow extends RowDataPacket {
  id: string; return_request_id: string; order_item_id: string; quantity: number; item_refund_minor: number | string;
  commission_reversal_minor: number | string; seller_reversal_minor: number | string; stock_disposition: string; restocked_at: Date | null;
}
interface PaymentRow extends RowDataPacket { id: string; order_id: string; provider_reference: string; expected_amount_minor: number | string; currency: string; status: string }
interface RefundRow extends RowDataPacket {
  id: string; return_request_id: string | null; payment_review_case_id: string | null; payment_id: string; provider_refund_id: string | null;
  amount_minor: number | string; delivery_refund_minor: number | string; currency: string; status: string; last_error: string | null; processed_at: Date | null;
}
interface ReviewRow extends RowDataPacket { id: string; order_id: string; payment_id: string; case_type: string; status: string }
interface CodRow extends RowDataPacket { id: string; order_id: string; idempotency_key: string; request_hash: string; amount_minor: number | string; currency: string; collection_reference: string; status: string; collected_at: Date; created_at: Date; updated_at: Date }
interface CountRow extends RowDataPacket { total: number | string }

const sellerTransitions: Record<string, SuborderStatus[]> = {
  pending: ['processing'],
  processing: ['shipped', 'ready_for_pickup']
};
const adminTransitions: Record<string, SuborderStatus[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'ready_for_pickup', 'cancelled'],
  shipped: ['delivered'],
  ready_for_pickup: ['picked_up']
};

export class FulfilmentService {
  public constructor(private readonly pool: Pool, private readonly refunds: RefundProvider, private readonly policy: FulfilmentPolicy) {}

  public async transitionSeller(actorUserId: string, orderId: string, toStatus: SuborderStatus, reason?: string): Promise<object> {
    const [sellers] = await this.pool.query<SellerRow[]>('SELECT id FROM sellers WHERE user_id = ?', [actorUserId]);
    if (!sellers[0]) throw new AppError(403, 'SELLER_PROFILE_REQUIRED', 'A seller profile is required');
    return this.transitionSuborder(actorUserId, 'seller', orderId, undefined, sellers[0].id, toStatus, reason);
  }

  public async transitionAdmin(actorUserId: string, orderId: string, suborderId: string, toStatus: SuborderStatus, reason?: string): Promise<object> {
    return this.transitionSuborder(actorUserId, 'admin', orderId, suborderId, undefined, toStatus, reason);
  }

  public async cancelOrder(access: ReturnOwner, orderId: string, reason: string): Promise<object> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const order = await this.lockOwnedOrder(connection, access, orderId);
      if (order.status === 'cancelled') { await connection.commit(); return this.orderProgress(orderId); }
      if (order.payment_method === 'paystack' && !['awaiting_payment', 'payment_failed', 'reservation_expired'].includes(order.status)) {
        throw new AppError(409, 'PAID_CANCELLATION_REQUIRES_RETURN', 'A paid order must use the return and refund workflow');
      }
      const [suborders] = await connection.query<SuborderRow[]>('SELECT * FROM seller_suborders WHERE order_id = ? ORDER BY id FOR UPDATE', [orderId]);
      if (suborders.some((item) => item.status !== 'pending')) throw new AppError(409, 'ORDER_CANCELLATION_TOO_LATE', 'An order cannot be cancelled after fulfilment starts');
      await this.restoreReservations(connection, orderId, undefined, 'customer_cancellation');
      await connection.query("UPDATE seller_suborders SET status = 'cancelled', fulfilled_at = NOW(3), stock_restored_at = COALESCE(stock_restored_at, NOW(3)) WHERE order_id = ?", [orderId]);
      await connection.query("UPDATE orders SET status = 'cancelled' WHERE id = ?", [orderId]);
      await connection.query("INSERT INTO order_status_events (order_id, from_status, to_status, reason, actor_type, actor_user_id) VALUES (?, ?, 'cancelled', ?, 'customer', ?)", [orderId, order.status, reason, access.kind === 'customer' ? access.userId : null]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return this.orderProgress(orderId);
  }

  public async requestReturn(access: ReturnOwner, orderId: string, items: ReturnItemInput[], reason: string, idempotencyKey: string): Promise<{ returnRequest: object; idempotentReplay: boolean }> {
    if (this.policy.returnWindowDays === undefined) throw new AppError(503, 'RETURN_POLICY_NOT_CONFIGURED', 'The return window policy is not configured');
    const requestHash = createHash('sha256').update(JSON.stringify({ items: [...items].sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)), reason })).digest('hex');
    const connection = await this.pool.getConnection();
    let returnId: string;
    let replay = false;
    try {
      await connection.beginTransaction();
      const order = await this.lockOwnedOrder(connection, access, orderId);
      const [existing] = await connection.query<ReturnRow[]>('SELECT * FROM return_requests WHERE order_id = ? AND idempotency_key = ? FOR UPDATE', [orderId, idempotencyKey]);
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was already used with different return input');
        returnId = existing[0].id; replay = true; await connection.commit();
      } else {
        if (!['delivered', 'returned'].includes(order.status)) throw new AppError(409, 'ORDER_NOT_RETURNABLE', 'The order is not in a returnable state');
        const ids = [...new Set(items.map((item) => item.orderItemId))];
        if (ids.length !== items.length) throw new AppError(400, 'DUPLICATE_RETURN_ITEM', 'Each order item may appear only once');
        const [orderItems] = await connection.query<ItemRow[]>(`SELECT * FROM order_items WHERE order_id = ? AND id IN (${ids.map(() => '?').join(', ')}) ORDER BY id FOR UPDATE`, [orderId, ...ids]);
        if (orderItems.length !== items.length) throw new AppError(404, 'ORDER_ITEM_NOT_FOUND', 'One or more order items were not found');
        const suborderIds = [...new Set(orderItems.map((item) => item.suborder_id))];
        const [suborders] = await connection.query<SuborderRow[]>(`SELECT * FROM seller_suborders WHERE id IN (${suborderIds.map(() => '?').join(', ')}) ORDER BY id FOR UPDATE`, suborderIds);
        const deadlineMs = this.policy.returnWindowDays * 24 * 60 * 60 * 1000;
        if (suborders.some((suborder) => !['delivered', 'picked_up', 'returned'].includes(suborder.status) || !suborder.fulfilled_at || suborder.fulfilled_at.getTime() + deadlineMs < Date.now())) {
          throw new AppError(409, 'RETURN_WINDOW_CLOSED', 'One or more items are outside the configured return window');
        }
        for (const input of items) {
          const item = orderItems.find((candidate) => candidate.id === input.orderItemId)!;
          const [counts] = await connection.query<CountRow[]>(`SELECT COALESCE(SUM(ri.quantity), 0) AS total FROM return_request_items ri JOIN return_requests rr ON rr.id = ri.return_request_id WHERE ri.order_item_id = ? AND rr.status <> 'rejected'`, [item.id]);
          if (Number(counts[0]!.total) + input.quantity > item.quantity) throw new AppError(409, 'RETURN_QUANTITY_EXCEEDED', 'Requested return quantity exceeds the unreturned quantity', { orderItemId: item.id });
        }
        returnId = randomUUID();
        await connection.query('INSERT INTO return_requests (id, order_id, idempotency_key, request_hash, reason, requested_by_user_id) VALUES (?, ?, ?, ?, ?, ?)', [returnId, orderId, idempotencyKey, requestHash, reason, access.kind === 'customer' ? access.userId : null]);
        for (const input of items) {
          const item = orderItems.find((candidate) => candidate.id === input.orderItemId)!;
          const gross = multiplyMoney(item.unit_price_minor, input.quantity);
          await connection.query('INSERT INTO return_request_items (id, return_request_id, order_item_id, quantity, item_refund_minor, commission_reversal_minor, seller_reversal_minor) VALUES (?, ?, ?, ?, ?, 0, ?)', [randomUUID(), returnId, item.id, input.quantity, gross, gross]);
        }
        await connection.query("INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('return_request', ?, 'return.requested', ?)", [returnId, JSON.stringify({ returnRequestId: returnId, orderId })]);
        await connection.commit();
      }
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return { returnRequest: await this.returnView(returnId), idempotentReplay: replay };
  }

  public async listReturns(access: ReturnOwner, orderId: string): Promise<object[]> {
    await this.assertOwnedOrder(access, orderId);
    const [rows] = await this.pool.query<ReturnRow[]>('SELECT * FROM return_requests WHERE order_id = ? ORDER BY created_at, id', [orderId]);
    return Promise.all(rows.map((row) => this.returnView(row.id)));
  }

  public async reviewReturn(actorUserId: string, returnId: string, action: 'approve' | 'reject', adminNote: string, stockDisposition?: 'restock' | 'no_restock'): Promise<object> {
    if (action === 'reject') {
      const [result] = await this.pool.query<ResultSetHeader>("UPDATE return_requests SET status = 'rejected', reviewed_by = ?, admin_note = ?, reviewed_at = NOW(3) WHERE id = ? AND status = 'requested'", [actorUserId, adminNote, returnId]);
      if (result.affectedRows === 0) {
        const [rows] = await this.pool.query<ReturnRow[]>('SELECT * FROM return_requests WHERE id = ?', [returnId]);
        if (!rows[0]) throw new AppError(404, 'RETURN_REQUEST_NOT_FOUND', 'Return request not found');
        if (rows[0].status !== 'rejected') throw new AppError(409, 'RETURN_ALREADY_REVIEWED', 'Return request was already reviewed');
      }
      return this.returnView(returnId);
    }
    if (!stockDisposition) throw new AppError(400, 'STOCK_DISPOSITION_REQUIRED', 'Approved returns require a stock disposition');
    if (this.policy.refundDeliveryMode === undefined) throw new AppError(503, 'REFUND_POLICY_NOT_CONFIGURED', 'The delivery-fee refund policy is not configured');
    const prepared = await this.prepareApprovedRefund(actorUserId, returnId, adminNote, stockDisposition);
    if (prepared.alreadyReviewed) {
      const current = await this.refundView(prepared.refundId) as { status: string; lastError: string | null };
      if (current.status === 'initiation_pending' && current.lastError === 'PAYSTACK_NOT_CONFIGURED') await this.initiateRefund(prepared.refundId, prepared.paymentReference, prepared.amountMinor, prepared.currency, `Return ${returnId}`);
      return this.returnView(returnId);
    }
    await this.initiateRefund(prepared.refundId, prepared.paymentReference, prepared.amountMinor, prepared.currency, `Return ${returnId}`);
    return this.returnView(returnId);
  }

  public async refundLatePayment(actorUserId: string, reviewCaseId: string): Promise<object> {
    const connection = await this.pool.getConnection();
    let refundId: string;
    let reference: string;
    let amount: number;
    let currency: string;
    let created = false;
    try {
      await connection.beginTransaction();
      const [cases] = await connection.query<ReviewRow[]>('SELECT * FROM payment_review_cases WHERE id = ? FOR UPDATE', [reviewCaseId]);
      const review = cases[0];
      if (!review || review.case_type !== 'late_payment') throw new AppError(404, 'PAYMENT_REVIEW_CASE_NOT_FOUND', 'Late-payment review case not found');
      const [payments] = await connection.query<PaymentRow[]>('SELECT * FROM payments WHERE id = ? FOR UPDATE', [review.payment_id]);
      const payment = payments[0]!;
      const [existing] = await connection.query<RefundRow[]>('SELECT * FROM refunds WHERE payment_review_case_id = ? FOR UPDATE', [reviewCaseId]);
      if (existing[0]) refundId = existing[0].id;
      else {
        refundId = randomUUID(); created = true;
        await connection.query('INSERT INTO refunds (id, payment_review_case_id, payment_id, amount_minor, currency, initiated_by) VALUES (?, ?, ?, ?, ?, ?)', [refundId, reviewCaseId, payment.id, payment.expected_amount_minor, payment.currency, actorUserId]);
        await connection.query("UPDATE payment_review_cases SET status = 'refund_pending' WHERE id = ?", [reviewCaseId]);
      }
      reference = payment.provider_reference; amount = moneyValue(payment.expected_amount_minor); currency = payment.currency;
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    if (created) await this.initiateRefund(refundId, reference, amount, currency, `Late payment review ${reviewCaseId}`);
    return this.refundView(refundId);
  }

  public async reconcileRefund(refundId: string): Promise<object> {
    const [rows] = await this.pool.query<RefundRow[]>('SELECT * FROM refunds WHERE id = ?', [refundId]);
    const refund = rows[0];
    if (!refund) throw new AppError(404, 'REFUND_NOT_FOUND', 'Refund not found');
    if (refund.status === 'processed') return this.refundView(refundId);
    if (!refund.provider_refund_id) throw new AppError(409, 'REFUND_REQUIRES_MANUAL_REVIEW', 'Refund has no provider identifier and cannot be safely retried automatically');
    const result = await this.refunds.fetch(refund.provider_refund_id);
    await this.applyProviderRefund(refundId, result);
    return this.refundView(refundId);
  }

  public async recordCodCollection(actorUserId: string, orderId: string, amountMinor: number, collectionReference: string, collectedAt: Date, idempotencyKey: string): Promise<{ collection: object; idempotentReplay: boolean }> {
    const requestHash = createHash('sha256').update(JSON.stringify({ orderId, amountMinor, collectionReference, collectedAt: collectedAt.toISOString() })).digest('hex');
    const connection = await this.pool.getConnection();
    let collectionId: string;
    let replay = false;
    try {
      await connection.beginTransaction();
      const [orders] = await connection.query<OrderRow[]>('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
      const order = orders[0];
      if (!order || order.payment_method !== 'cod') throw new AppError(404, 'COD_ORDER_NOT_FOUND', 'Cash-on-delivery order not found');
      if (order.status !== 'delivered') throw new AppError(409, 'COD_ORDER_NOT_DELIVERED', 'Cash collection can be recorded only after delivery or pickup');
      if (amountMinor !== moneyValue(order.grand_total_minor)) throw new AppError(409, 'COD_COLLECTION_AMOUNT_MISMATCH', 'Collected amount must equal the order total');
      const [existing] = await connection.query<CodRow[]>('SELECT * FROM cod_collections WHERE order_id = ? FOR UPDATE', [orderId]);
      if (existing[0]) {
        if (existing[0].idempotency_key !== idempotencyKey || existing[0].request_hash !== requestHash) throw new AppError(409, 'COD_COLLECTION_ALREADY_RECORDED', 'Cash collection was already recorded with different input');
        collectionId = existing[0].id; replay = true;
      } else {
        collectionId = randomUUID();
        await connection.query('INSERT INTO cod_collections (id, order_id, idempotency_key, request_hash, amount_minor, currency, collection_reference, collected_at, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [collectionId, orderId, idempotencyKey, requestHash, amountMinor, order.currency, collectionReference, collectedAt, actorUserId]);
      }
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return { collection: await this.codView(collectionId), idempotentReplay: replay };
  }

  public async reconcileCodCollection(actorUserId: string, collectionId: string, action: 'confirm' | 'reject', note: string): Promise<object> {
    const [result] = await this.pool.query<ResultSetHeader>(`UPDATE cod_collections SET status = ?, reconciled_by = ?, reconciliation_note = ?, reconciled_at = NOW(3) WHERE id = ? AND status = 'recorded'`, [action === 'confirm' ? 'confirmed' : 'rejected', actorUserId, note, collectionId]);
    if (result.affectedRows === 0) {
      const [rows] = await this.pool.query<CodRow[]>('SELECT * FROM cod_collections WHERE id = ?', [collectionId]);
      if (!rows[0]) throw new AppError(404, 'COD_COLLECTION_NOT_FOUND', 'Cash collection not found');
      throw new AppError(409, 'COD_COLLECTION_ALREADY_RECONCILED', 'Cash collection was already reconciled');
    }
    return this.codView(collectionId);
  }

  public async handleRefundWebhook(event: { event: string; data: Record<string, unknown> }, rawBody: Buffer): Promise<object> {
    const transactionReference = typeof event.data.transaction_reference === 'string' ? event.data.transaction_reference : undefined;
    const amountValue = typeof event.data.amount === 'string' ? Number(event.data.amount) : event.data.amount;
    const currency = event.data.currency;
    if (!transactionReference || !Number.isSafeInteger(amountValue) || Number(amountValue) < 0 || typeof currency !== 'string') {
      throw new AppError(400, 'INVALID_REFUND_WEBHOOK', 'Refund webhook data is invalid');
    }
    const eventKey = createHash('sha256').update(rawBody).digest('hex');
    const connection = await this.pool.getConnection();
    let refundId: string | undefined;
    try {
      await connection.beginTransaction();
      const [payments] = await connection.query<PaymentRow[]>('SELECT * FROM payments WHERE provider_reference = ? FOR UPDATE', [transactionReference]);
      const payment = payments[0];
      if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Webhook payment not found');
      const [inserted] = await connection.query<ResultSetHeader>("INSERT IGNORE INTO payment_webhook_events (provider, event_key, event_type, payment_id, payload_sha256) VALUES ('paystack', ?, ?, ?, ?)", [eventKey, event.event, payment.id, eventKey]);
      if (inserted.affectedRows === 0) {
        const [stored] = await connection.query<Array<RowDataPacket & { status: string }>>("SELECT status FROM payment_webhook_events WHERE provider = 'paystack' AND event_key = ? FOR UPDATE", [eventKey]);
        if (stored[0]?.status === 'processed') { await connection.commit(); return { duplicate: true }; }
      }
      const [matches] = await connection.query<RefundRow[]>("SELECT * FROM refunds WHERE payment_id = ? AND amount_minor = ? AND currency = ? AND status IN ('initiation_pending', 'initiation_uncertain', 'pending', 'processing', 'needs_attention') ORDER BY created_at FOR UPDATE", [payment.id, amountValue, currency]);
      if (matches.length !== 1) throw new AppError(409, 'REFUND_WEBHOOK_AMBIGUOUS', 'Refund webhook could not be associated safely');
      refundId = matches[0]!.id;
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    await this.applyProviderRefund(refundId, { id: String(event.data.id ?? event.data.refund_reference ?? ''), status: String(event.data.status ?? event.event.replace('refund.', '')), amountMinor: Number(amountValue), currency, transactionReference, processedAt: null });
    await this.pool.query("UPDATE payment_webhook_events SET status = 'processed', result_code = ?, processed_at = NOW(3) WHERE provider = 'paystack' AND event_key = ?", [event.event, eventKey]);
    return { duplicate: false, refund: await this.refundView(refundId) };
  }

  public async orderProgress(orderId: string): Promise<object> {
    const [orders] = await this.pool.query<OrderRow[]>('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!orders[0]) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    const [suborders] = await this.pool.query<SuborderRow[]>('SELECT * FROM seller_suborders WHERE order_id = ? ORDER BY seller_id', [orderId]);
    const [collections] = await this.pool.query<CodRow[]>('SELECT * FROM cod_collections WHERE order_id = ?', [orderId]);
    return {
      orderId, status: orders[0].status, deliveryMethod: orders[0].delivery_method, destination: jsonObject(orders[0].destination_snapshot),
      suborders: suborders.map((row) => ({ id: row.id, sellerId: row.seller_id, status: row.status, fulfilledAt: row.fulfilled_at?.toISOString() ?? null })),
      codCollection: collections[0] ? codObject(collections[0]) : null,
      codEarningsEligible: collections[0]?.status === 'confirmed'
    };
  }

  private async transitionSuborder(actorUserId: string, actorType: 'seller' | 'admin', orderId: string, suborderId: string | undefined, sellerId: string | undefined, toStatus: SuborderStatus, reason?: string): Promise<object> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [orders] = await connection.query<OrderRow[]>('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
      const order = orders[0];
      if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
      if (!['paid', 'awaiting_collection', 'processing', 'shipped'].includes(order.status)) throw new AppError(409, 'ORDER_NOT_FULFILLABLE', 'Order is not ready for fulfilment');
      const [rows] = await connection.query<SuborderRow[]>(`SELECT * FROM seller_suborders WHERE order_id = ? AND ${suborderId ? 'id' : 'seller_id'} = ? FOR UPDATE`, [orderId, suborderId ?? sellerId]);
      const suborder = rows[0];
      if (!suborder) throw new AppError(404, 'SUBORDER_NOT_FOUND', 'Seller order portion not found');
      const allowed = actorType === 'seller' ? sellerTransitions[suborder.status] ?? [] : adminTransitions[suborder.status] ?? [];
      if (!allowed.includes(toStatus)) throw new AppError(409, 'INVALID_FULFILMENT_TRANSITION', `Suborder cannot transition from ${suborder.status} to ${toStatus}`);
      if (order.delivery_method === 'delivery' && ['ready_for_pickup', 'picked_up'].includes(toStatus)) throw new AppError(409, 'INVALID_DELIVERY_TRANSITION', 'A delivery order cannot use pickup states');
      if (order.delivery_method === 'pickup' && ['shipped', 'delivered'].includes(toStatus)) throw new AppError(409, 'INVALID_PICKUP_TRANSITION', 'A pickup order cannot use delivery states');
      if (toStatus === 'cancelled' && order.payment_method === 'paystack') throw new AppError(409, 'PAID_CANCELLATION_REQUIRES_RETURN', 'Paid fulfilment cancellation must use the return and refund workflow');
      if (toStatus === 'processing') await connection.query("UPDATE inventory_reservations ir JOIN order_items oi ON oi.id = ir.order_item_id SET ir.status = 'consumed' WHERE oi.suborder_id = ? AND ir.status = 'active'", [suborder.id]);
      if (toStatus === 'cancelled') await this.restoreReservations(connection, orderId, suborder.id, 'fulfilment_cancellation', true);
      const fulfilled = ['delivered', 'picked_up', 'cancelled'].includes(toStatus);
      await connection.query('UPDATE seller_suborders SET status = ?, fulfilled_at = CASE WHEN ? THEN COALESCE(fulfilled_at, NOW(3)) ELSE fulfilled_at END, stock_restored_at = CASE WHEN ? THEN COALESCE(stock_restored_at, NOW(3)) ELSE stock_restored_at END WHERE id = ?', [toStatus, fulfilled, toStatus === 'cancelled', suborder.id]);
      await connection.query('INSERT INTO fulfilment_events (order_id, suborder_id, from_status, to_status, reason, actor_user_id) VALUES (?, ?, ?, ?, ?, ?)', [orderId, suborder.id, suborder.status, toStatus, reason ?? null, actorUserId]);
      const newOrderStatus = await this.aggregateOrderStatus(connection, order, orderId);
      if (newOrderStatus !== order.status) {
        await connection.query('UPDATE orders SET status = ? WHERE id = ?', [newOrderStatus, orderId]);
        await connection.query('INSERT INTO order_status_events (order_id, from_status, to_status, reason, actor_type, actor_user_id) VALUES (?, ?, ?, ?, ?, ?)', [orderId, order.status, newOrderStatus, 'suborder_fulfilment_progress', actorType, actorUserId]);
      }
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return this.orderProgress(orderId);
  }

  private async aggregateOrderStatus(connection: PoolConnection, order: OrderRow, orderId: string): Promise<string> {
    const [rows] = await connection.query<SuborderRow[]>('SELECT * FROM seller_suborders WHERE order_id = ? ORDER BY id FOR UPDATE', [orderId]);
    const statuses = rows.map((row) => row.status);
    if (statuses.every((status) => status === 'cancelled')) return 'cancelled';
    if (statuses.every((status) => ['delivered', 'picked_up', 'cancelled', 'refunded'].includes(status))) return 'delivered';
    if (order.delivery_method === 'delivery' && statuses.every((status) => ['shipped', 'delivered', 'cancelled'].includes(status))) return 'shipped';
    if (statuses.some((status) => status !== 'pending')) return 'processing';
    return order.status;
  }

  private async restoreReservations(connection: PoolConnection, orderId: string, suborderId: string | undefined, reason: string, includeConsumed = false): Promise<void> {
    const [rows] = await connection.query<ReservationRow[]>(`SELECT ir.* FROM inventory_reservations ir JOIN order_items oi ON oi.id = ir.order_item_id WHERE ir.order_id = ? ${suborderId ? 'AND oi.suborder_id = ?' : ''} ORDER BY ir.product_id FOR UPDATE`, suborderId ? [orderId, suborderId] : [orderId]);
    for (const row of rows) {
      if (row.status !== 'active' && !(includeConsumed && row.status === 'consumed')) continue;
      const [updated] = await connection.query<ResultSetHeader>(`UPDATE inventory_reservations SET status = 'released', released_at = NOW(3), release_reason = ? WHERE id = ? AND status ${includeConsumed ? "IN ('active', 'consumed')" : "= 'active'"}`, [reason, row.id]);
      if (updated.affectedRows === 1) await connection.query('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?', [row.quantity, row.product_id]);
    }
  }

  private async prepareApprovedRefund(actorUserId: string, returnId: string, adminNote: string, stockDisposition: 'restock' | 'no_restock'): Promise<{ refundId: string; paymentReference: string; amountMinor: number; currency: string; alreadyReviewed: boolean }> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [returns] = await connection.query<ReturnRow[]>('SELECT * FROM return_requests WHERE id = ? FOR UPDATE', [returnId]);
      const request = returns[0];
      if (!request) throw new AppError(404, 'RETURN_REQUEST_NOT_FOUND', 'Return request not found');
      const [existingRefunds] = await connection.query<RefundRow[]>('SELECT * FROM refunds WHERE return_request_id = ? FOR UPDATE', [returnId]);
      if (request.status !== 'requested') {
        if (existingRefunds[0]) {
          const [payment] = await connection.query<PaymentRow[]>('SELECT * FROM payments WHERE id = ?', [existingRefunds[0].payment_id]);
          await connection.commit();
          return { refundId: existingRefunds[0].id, paymentReference: payment[0]!.provider_reference, amountMinor: moneyValue(existingRefunds[0].amount_minor), currency: existingRefunds[0].currency, alreadyReviewed: true };
        }
        throw new AppError(409, 'RETURN_ALREADY_REVIEWED', 'Return request was already reviewed');
      }
      const [orders] = await connection.query<OrderRow[]>('SELECT * FROM orders WHERE id = ? FOR UPDATE', [request.order_id]);
      const order = orders[0]!;
      if (order.payment_method !== 'paystack') throw new AppError(409, 'COD_REFUND_POLICY_UNRESOLVED', 'Cash-on-delivery refunds require an approved manual refund policy');
      const [payments] = await connection.query<PaymentRow[]>("SELECT * FROM payments WHERE order_id = ? AND status = 'succeeded' FOR UPDATE", [order.id]);
      const payment = payments[0];
      if (!payment) throw new AppError(409, 'REFUNDABLE_PAYMENT_NOT_FOUND', 'A successful Paystack payment was not found');
      const [returnItems] = await connection.query<ReturnItemRow[]>('SELECT * FROM return_request_items WHERE return_request_id = ? ORDER BY order_item_id FOR UPDATE', [returnId]);
      const itemIds = returnItems.map((item) => item.order_item_id);
      const [orderItems] = await connection.query<ItemRow[]>(`SELECT * FROM order_items WHERE id IN (${itemIds.map(() => '?').join(', ')}) ORDER BY id FOR UPDATE`, itemIds);
      for (const returnItem of returnItems) {
        const item = orderItems.find((candidate) => candidate.id === returnItem.order_item_id)!;
        const [prior] = await connection.query<CountRow[]>(`SELECT COALESCE(SUM(ri.quantity), 0) AS total FROM return_request_items ri JOIN return_requests rr ON rr.id = ri.return_request_id WHERE ri.order_item_id = ? AND rr.id <> ? AND rr.status IN ('approved', 'refund_pending', 'refunded')`, [item.id, returnId]);
        const priorQuantity = Number(prior[0]!.total);
        const cumulative = priorQuantity + returnItem.quantity;
        const totalCommission = BigInt(item.commission_minor);
        const targetCommission = (totalCommission * BigInt(cumulative) + BigInt(item.quantity) / 2n) / BigInt(item.quantity);
        const priorCommission = (totalCommission * BigInt(priorQuantity) + BigInt(item.quantity) / 2n) / BigInt(item.quantity);
        const reversal = moneyValue(targetCommission - priorCommission);
        const gross = multiplyMoney(item.unit_price_minor, returnItem.quantity);
        await connection.query('UPDATE return_request_items SET item_refund_minor = ?, commission_reversal_minor = ?, seller_reversal_minor = ?, stock_disposition = ? WHERE id = ?', [gross, reversal, moneyValue(BigInt(gross) - BigInt(reversal)), stockDisposition, returnItem.id]);
        if (stockDisposition === 'restock' && !returnItem.restocked_at) {
          await connection.query('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?', [returnItem.quantity, item.product_id]);
          await connection.query('UPDATE return_request_items SET restocked_at = NOW(3) WHERE id = ? AND restocked_at IS NULL', [returnItem.id]);
        }
      }
      const itemRefund = addMoney(returnItems.map((item) => item.item_refund_minor));
      const [allCounts] = await connection.query<Array<RowDataPacket & { ordered: number | string; approved: number | string }>>(`SELECT (SELECT SUM(quantity) FROM order_items WHERE order_id = ?) AS ordered, (SELECT COALESCE(SUM(ri.quantity), 0) FROM return_request_items ri JOIN return_requests rr ON rr.id = ri.return_request_id WHERE rr.order_id = ? AND rr.status IN ('approved', 'refund_pending', 'refunded')) + ? AS approved`, [order.id, order.id, returnItems.reduce((sum, item) => sum + item.quantity, 0)]);
      const fullOrder = Number(allCounts[0]!.approved) >= Number(allCounts[0]!.ordered);
      const deliveryRefund = this.policy.refundDeliveryMode === 'full_order' && fullOrder ? moneyValue(order.delivery_total_minor) : 0;
      const total = moneyValue(BigInt(itemRefund) + BigInt(deliveryRefund));
      const refundId = randomUUID();
      await connection.query("UPDATE return_requests SET status = 'refund_pending', reviewed_by = ?, admin_note = ?, reviewed_at = NOW(3) WHERE id = ?", [actorUserId, adminNote, returnId]);
      await connection.query('INSERT INTO refunds (id, return_request_id, payment_id, amount_minor, delivery_refund_minor, currency, initiated_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [refundId, returnId, payment.id, total, deliveryRefund, payment.currency, actorUserId]);
      await connection.commit();
      return { refundId, paymentReference: payment.provider_reference, amountMinor: total, currency: payment.currency, alreadyReviewed: false };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  private async initiateRefund(refundId: string, paymentReference: string, amountMinor: number, currency: string, note: string): Promise<void> {
    try {
      const result = await this.refunds.create({ transactionReference: paymentReference, amountMinor, currency: currency as 'NGN', customerNote: note, merchantNote: `Legit Hair ${note}` });
      await this.applyProviderRefund(refundId, result);
    } catch (error) {
      const providerError = error instanceof PaymentProviderError ? error : new PaymentProviderError('PAYSTACK_UNAVAILABLE', error instanceof Error ? error.message : 'Refund initiation failed', true);
      const status = providerError.code === 'PAYSTACK_NOT_CONFIGURED' ? 'initiation_pending' : providerError.transient ? 'initiation_uncertain' : 'failed';
      await this.pool.query('UPDATE refunds SET status = ?, last_error = ? WHERE id = ? AND status = \'initiation_pending\'', [status, providerError.code, refundId]);
      if (status === 'failed') await this.pool.query("UPDATE return_requests rr JOIN refunds r ON r.return_request_id = rr.id SET rr.status = 'refund_failed' WHERE r.id = ?", [refundId]);
      throw new AppError(providerError.transient ? 503 : 409, providerError.code === 'PAYSTACK_NOT_CONFIGURED' ? 'REFUND_PROVIDER_NOT_CONFIGURED' : 'REFUND_PROVIDER_ERROR', providerError.code === 'PAYSTACK_NOT_CONFIGURED' ? 'Paystack refunds are not configured' : 'Refund initiation could not be confirmed');
    }
  }

  private async applyProviderRefund(refundId: string, result: ProviderRefund): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<RefundRow[]>('SELECT * FROM refunds WHERE id = ? FOR UPDATE', [refundId]);
      const refund = rows[0];
      if (!refund) throw new AppError(404, 'REFUND_NOT_FOUND', 'Refund not found');
      if (moneyValue(refund.amount_minor) !== result.amountMinor || refund.currency !== result.currency) throw new AppError(409, 'REFUND_PROVIDER_MISMATCH', 'Provider refund amount or currency did not match');
      const mapped = mapRefundStatus(result.status);
      if (refund.status === 'processed') { await connection.commit(); return; }
      await connection.query('UPDATE refunds SET provider_refund_id = COALESCE(provider_refund_id, ?), status = ?, last_error = NULL, processed_at = CASE WHEN ? = \'processed\' THEN COALESCE(processed_at, NOW(3)) ELSE processed_at END WHERE id = ?', [result.id || null, mapped, mapped, refundId]);
      if (mapped === 'failed' && refund.return_request_id) await connection.query("UPDATE return_requests SET status = 'refund_failed' WHERE id = ?", [refund.return_request_id]);
      if (mapped === 'processed') await this.completeRefund(connection, refund);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  private async completeRefund(connection: PoolConnection, refund: RefundRow): Promise<void> {
    const [payments] = await connection.query<PaymentRow[]>('SELECT * FROM payments WHERE id = ? FOR UPDATE', [refund.payment_id]);
    const payment = payments[0]!;
    const [existing] = await connection.query<CountRow[]>('SELECT COUNT(*) AS total FROM payment_ledger_entries WHERE logical_key = ?', [`refund:${refund.id}`]);
    if (Number(existing[0]!.total) > 0) return;
    await connection.query(`INSERT INTO payment_ledger_entries (id, order_id, payment_id, refund_id, logical_key, entry_type, direction, amount_minor, currency, description)
      VALUES (?, ?, ?, ?, ?, 'refund_processed', 'debit', ?, ?, 'Processed customer refund')`, [randomUUID(), payment.order_id, payment.id, refund.id, `refund:${refund.id}`, refund.amount_minor, refund.currency]);
    if (refund.return_request_id) {
      await connection.query("UPDATE return_requests SET status = 'refunded' WHERE id = ?", [refund.return_request_id]);
      const [items] = await connection.query<Array<ReturnItemRow & ItemRow>>(`SELECT ri.*, oi.suborder_id, oi.seller_id FROM return_request_items ri JOIN order_items oi ON oi.id = ri.order_item_id WHERE ri.return_request_id = ?`, [refund.return_request_id]);
      const grouped = new Map<string, { sellerId: string; gross: number; commission: number; seller: number }>();
      for (const item of items) {
        const current = grouped.get(item.suborder_id) ?? { sellerId: item.seller_id, gross: 0, commission: 0, seller: 0 };
        current.gross = moneyValue(BigInt(current.gross) + BigInt(item.item_refund_minor));
        current.commission = moneyValue(BigInt(current.commission) + BigInt(item.commission_reversal_minor));
        current.seller = moneyValue(BigInt(current.seller) + BigInt(item.seller_reversal_minor));
        grouped.set(item.suborder_id, current);
      }
      for (const [suborderId, values] of grouped) await connection.query(`INSERT IGNORE INTO seller_refund_adjustments (id, refund_id, seller_id, suborder_id, item_gross_reversal_minor, commission_reversal_minor, seller_reversal_minor) VALUES (?, ?, ?, ?, ?, ?, ?)`, [randomUUID(), refund.id, values.sellerId, suborderId, values.gross, values.commission, values.seller]);
      const [quantity] = await connection.query<Array<RowDataPacket & { ordered: number | string; refunded: number | string }>>(`SELECT (SELECT SUM(quantity) FROM order_items WHERE order_id = ?) AS ordered, (SELECT COALESCE(SUM(ri.quantity), 0) FROM return_request_items ri JOIN return_requests rr ON rr.id = ri.return_request_id WHERE rr.order_id = ? AND rr.status = 'refunded') AS refunded`, [payment.order_id, payment.order_id]);
      if (Number(quantity[0]!.refunded) >= Number(quantity[0]!.ordered)) {
        const [orders] = await connection.query<OrderRow[]>('SELECT * FROM orders WHERE id = ? FOR UPDATE', [payment.order_id]);
        await connection.query("UPDATE orders SET status = 'refunded' WHERE id = ?", [payment.order_id]);
        await connection.query("UPDATE seller_suborders SET status = 'refunded' WHERE order_id = ? AND status IN ('delivered', 'picked_up', 'returned')", [payment.order_id]);
        await connection.query("INSERT INTO order_status_events (order_id, from_status, to_status, reason, actor_type) VALUES (?, ?, 'refunded', 'full_order_refund_processed', 'provider')", [payment.order_id, orders[0]!.status]);
      }
    }
    if (refund.payment_review_case_id) await connection.query("UPDATE payment_review_cases SET status = 'resolved', resolved_at = NOW(3) WHERE id = ?", [refund.payment_review_case_id]);
    await connection.query("INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('refund', ?, 'refund.processed', ?)", [refund.id, JSON.stringify({ refundId: refund.id, orderId: payment.order_id, amountMinor: moneyValue(refund.amount_minor), currency: refund.currency })]);
  }

  private async lockOwnedOrder(connection: PoolConnection, access: ReturnOwner, orderId: string): Promise<OrderRow> {
    const [rows] = await connection.query<OrderRow[]>('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    const order = rows[0];
    const owns = order && (access.kind === 'customer' ? order.user_id === access.userId : order.guest_tracking_token_hash === hashToken(access.trackingToken));
    if (!owns) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    return order;
  }

  private async assertOwnedOrder(access: ReturnOwner, orderId: string): Promise<void> {
    const [rows] = await this.pool.query<OrderRow[]>('SELECT * FROM orders WHERE id = ?', [orderId]);
    const order = rows[0];
    if (!order || (access.kind === 'customer' ? order.user_id !== access.userId : order.guest_tracking_token_hash !== hashToken(access.trackingToken))) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }

  private async returnView(returnId: string): Promise<object> {
    const [rows] = await this.pool.query<ReturnRow[]>('SELECT * FROM return_requests WHERE id = ?', [returnId]);
    const row = rows[0];
    if (!row) throw new AppError(404, 'RETURN_REQUEST_NOT_FOUND', 'Return request not found');
    const [items] = await this.pool.query<ReturnItemRow[]>('SELECT * FROM return_request_items WHERE return_request_id = ? ORDER BY order_item_id', [returnId]);
    const [refunds] = await this.pool.query<RefundRow[]>('SELECT * FROM refunds WHERE return_request_id = ?', [returnId]);
    return { id: row.id, orderId: row.order_id, reason: row.reason, status: row.status, adminNote: row.admin_note, items: items.map((item) => ({ orderItemId: item.order_item_id, quantity: item.quantity, itemRefundMinor: moneyValue(item.item_refund_minor), commissionReversalMinor: moneyValue(item.commission_reversal_minor), sellerReversalMinor: moneyValue(item.seller_reversal_minor), stockDisposition: item.stock_disposition })), refund: refunds[0] ? refundObject(refunds[0]) : null, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
  }

  private async refundView(refundId: string): Promise<object> {
    const [rows] = await this.pool.query<RefundRow[]>('SELECT * FROM refunds WHERE id = ?', [refundId]);
    if (!rows[0]) throw new AppError(404, 'REFUND_NOT_FOUND', 'Refund not found');
    return refundObject(rows[0]);
  }

  private async codView(collectionId: string): Promise<object> {
    const [rows] = await this.pool.query<CodRow[]>('SELECT * FROM cod_collections WHERE id = ?', [collectionId]);
    if (!rows[0]) throw new AppError(404, 'COD_COLLECTION_NOT_FOUND', 'Cash collection not found');
    return codObject(rows[0]);
  }
}

function mapRefundStatus(status: string): 'pending' | 'processing' | 'needs_attention' | 'processed' | 'failed' {
  const normalized = status.toLowerCase().replaceAll('-', '_');
  if (normalized === 'pending') return 'pending';
  if (normalized === 'processing') return 'processing';
  if (normalized === 'processed' || normalized === 'success' || normalized === 'succeeded') return 'processed';
  if (normalized === 'needs_attention') return 'needs_attention';
  if (normalized === 'failed') return 'failed';
  throw new AppError(409, 'UNKNOWN_REFUND_STATUS', 'Provider returned an unknown refund status');
}

function refundObject(row: RefundRow): object { return { id: row.id, returnRequestId: row.return_request_id, paymentReviewCaseId: row.payment_review_case_id, paymentId: row.payment_id, providerRefundId: row.provider_refund_id, amountMinor: moneyValue(row.amount_minor), deliveryRefundMinor: moneyValue(row.delivery_refund_minor), currency: row.currency, status: row.status, lastError: row.last_error, processedAt: row.processed_at?.toISOString() ?? null }; }
function codObject(row: CodRow): object { return { id: row.id, orderId: row.order_id, amountMinor: moneyValue(row.amount_minor), currency: row.currency, collectionReference: row.collection_reference, status: row.status, collectedAt: row.collected_at.toISOString(), earningsEligible: row.status === 'confirmed', createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() }; }
function jsonObject(value: string | object | null): object | null { return value === null ? null : typeof value === 'string' ? JSON.parse(value) as object : value; }
