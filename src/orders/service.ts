import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { hashToken } from '../auth/token.js';
import { addMoney, moneyValue } from '../baskets/money.js';
import { AppError } from '../http/errors.js';
import type { OrderAccess, OrderOwner, OrderPolicy, OrderStatus, PaymentMethod } from './types.js';

interface QuoteOwnerRow extends RowDataPacket {
  id: string; basket_id: string; user_id: string | null; guest_token_hash: string | null; basket_status: string; basket_expires_at: Date | null;
  delivery_method: 'delivery' | 'pickup'; destination_snapshot: string | object | null; items_subtotal_minor: number | string;
  delivery_total_minor: number | string; grand_total_minor: number | string; expires_at: Date;
}
interface QuoteItemRow extends RowDataPacket { product_id: string; seller_id: string; product_name: string; quantity: number; unit_price_minor: number | string; line_total_minor: number | string }
interface AllocationRow extends RowDataPacket { seller_id: string; fee_minor: number | string }
interface ProductRow extends RowDataPacket { id: string; stock_quantity: number; publication_status: string; identity_status: string; approval_status: string }
interface OrderRow extends RowDataPacket {
  id: string; quote_id: string; basket_id: string; user_id: string | null; guest_tracking_token_hash: string | null; idempotency_key: string; request_hash: string;
  payment_method: PaymentMethod; status: OrderStatus; delivery_method: 'delivery' | 'pickup'; destination_snapshot: string | object | null;
  items_subtotal_minor: number | string; delivery_total_minor: number | string; grand_total_minor: number | string; currency: string;
  commission_basis: string; commission_rate_bps: number; reservation_expires_at: Date; created_at: Date; updated_at: Date;
}
interface OrderItemRow extends RowDataPacket { id: string; suborder_id: string; product_id: string; seller_id: string; product_name: string; quantity: number; unit_price_minor: number | string; line_total_minor: number | string; commission_basis: string; commission_rate_bps: number; commission_minor: number | string }
interface SuborderRow extends RowDataPacket { id: string; seller_id: string; status: string; items_subtotal_minor: number | string; delivery_fee_minor: number | string; commission_minor: number | string; seller_net_minor: number | string }
interface ReservationRow extends RowDataPacket { id: string; product_id: string; quantity: number; status: 'active' | 'consumed' | 'released'; expires_at: Date; released_at: Date | null; release_reason: string | null }

const releasableStatuses = new Set<OrderStatus>(['awaiting_payment', 'awaiting_collection']);
const allowedTransitions: Partial<Record<OrderStatus, OrderStatus[]>> = {
  awaiting_payment: ['payment_failed', 'reservation_expired', 'cancelled'],
  awaiting_collection: ['reservation_expired', 'cancelled']
};

export class OrderService {
  public constructor(private readonly pool: Pool, private readonly policy: OrderPolicy) {}

  public async createOrder(owner: OrderOwner, quoteId: string, paymentMethod: PaymentMethod, idempotencyKey: string): Promise<{ order: object; idempotentReplay: boolean; guestTrackingToken?: string }> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try { return await this.createOrderAttempt(owner, quoteId, paymentMethod, idempotencyKey); }
      catch (error) {
        if (!isRetryableTransactionError(error) || attempt === 4) throw error;
        await retryDelay(attempt);
      }
    }
    throw new AppError(503, 'ORDER_TRANSACTION_RETRY_EXHAUSTED', 'Order transaction could not be completed');
  }

  private async createOrderAttempt(owner: OrderOwner, quoteId: string, paymentMethod: PaymentMethod, idempotencyKey: string): Promise<{ order: object; idempotentReplay: boolean; guestTrackingToken?: string }> {
    const connection = await this.pool.getConnection();
    const requestHash = createHash('sha256').update(JSON.stringify({ quoteId, paymentMethod })).digest('hex');
    let orderId: string;
    let replay = false;
    let guestTrackingToken: string | undefined;
    try {
      await connection.beginTransaction();
      const quote = await this.lockOwnedQuote(connection, owner, quoteId);
      const [byKey] = await connection.query<OrderRow[]>('SELECT * FROM orders WHERE basket_id = ? AND idempotency_key = ? FOR UPDATE', [quote.basket_id, idempotencyKey]);
      if (byKey[0]) {
        if (byKey[0].request_hash !== requestHash) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was already used with different order input');
        orderId = byKey[0].id;
        replay = true;
        guestTrackingToken = byKey[0].user_id ? undefined : this.guestTrackingToken(orderId, false);
        await connection.commit();
      } else {
        const [byQuote] = await connection.query<OrderRow[]>('SELECT * FROM orders WHERE quote_id = ? FOR UPDATE', [quoteId]);
        if (byQuote[0]) throw new AppError(409, 'QUOTE_ALREADY_CHECKED_OUT', 'The quote has already been used to create an order');
        const configured = this.requireConfiguredPolicy(owner, paymentMethod);
        if (quote.expires_at.getTime() <= Date.now()) throw new AppError(410, 'QUOTE_EXPIRED', 'Checkout quote has expired');
        const [items] = await connection.query<QuoteItemRow[]>('SELECT * FROM checkout_quote_items WHERE quote_id = ? ORDER BY product_id', [quoteId]);
        const [allocations] = await connection.query<AllocationRow[]>('SELECT * FROM checkout_quote_delivery_allocations WHERE quote_id = ? ORDER BY seller_id', [quoteId]);
        if (!items.length) throw new AppError(409, 'QUOTE_EMPTY', 'Checkout quote has no items');
        const placeholders = items.map(() => '?').join(', ');
        const [products] = await connection.query<ProductRow[]>(`SELECT p.id, p.stock_quantity, p.publication_status, s.identity_status, s.approval_status FROM products p JOIN sellers s ON s.id = p.seller_id WHERE p.id IN (${placeholders}) ORDER BY p.id FOR UPDATE`, items.map((item) => item.product_id));
        const productById = new Map(products.map((product) => [product.id, product]));
        const unavailable = items.filter((item) => {
          const product = productById.get(item.product_id);
          return !product || product.publication_status !== 'published' || product.identity_status !== 'verified' || product.approval_status !== 'approved' || product.stock_quantity < item.quantity;
        }).map((item) => item.product_id);
        if (unavailable.length) throw new AppError(409, 'ORDER_ITEM_UNAVAILABLE', 'One or more quoted items can no longer be reserved', { productIds: unavailable });

        orderId = randomUUID();
        guestTrackingToken = owner.kind === 'guest' ? this.guestTrackingToken(orderId, true) : undefined;
        const initialStatus: OrderStatus = paymentMethod === 'cod' ? 'awaiting_collection' : 'awaiting_payment';
        await connection.query(`INSERT INTO orders (id, quote_id, basket_id, user_id, guest_tracking_token_hash, idempotency_key, request_hash, payment_method, status, delivery_method, destination_snapshot, items_subtotal_minor, delivery_total_minor, grand_total_minor, commission_basis, commission_rate_bps, reservation_expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL ? SECOND))`, [orderId, quoteId, quote.basket_id, owner.kind === 'customer' ? owner.userId : null, guestTrackingToken ? hashToken(guestTrackingToken) : null, idempotencyKey, requestHash, paymentMethod, initialStatus, quote.delivery_method, jsonValue(quote.destination_snapshot), quote.items_subtotal_minor, quote.delivery_total_minor, quote.grand_total_minor, configured.commissionBasis, configured.commissionRateBps, configured.reservationTtlSeconds]);

        const allocationBySeller = new Map(allocations.map((allocation) => [allocation.seller_id, moneyValue(allocation.fee_minor)]));
        const grouped = new Map<string, QuoteItemRow[]>();
        for (const item of items) grouped.set(item.seller_id, [...(grouped.get(item.seller_id) ?? []), item]);
        for (const [sellerId, sellerItems] of grouped) {
          const suborderId = randomUUID();
          const subtotal = addMoney(sellerItems.map((item) => item.line_total_minor));
          const commissions = sellerItems.map((item) => commissionAmount(item.line_total_minor, configured.commissionRateBps));
          const commission = addMoney(commissions);
          const sellerNet = moneyValue(BigInt(subtotal) - BigInt(commission));
          await connection.query('INSERT INTO seller_suborders (id, order_id, seller_id, items_subtotal_minor, delivery_fee_minor, commission_minor, seller_net_minor) VALUES (?, ?, ?, ?, ?, ?, ?)', [suborderId, orderId, sellerId, subtotal, allocationBySeller.get(sellerId) ?? 0, commission, sellerNet]);
          for (let index = 0; index < sellerItems.length; index++) {
            const item = sellerItems[index]!;
            const itemId = randomUUID();
            await connection.query('INSERT INTO order_items (id, order_id, suborder_id, product_id, seller_id, product_name, quantity, unit_price_minor, line_total_minor, commission_basis, commission_rate_bps, commission_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [itemId, orderId, suborderId, item.product_id, sellerId, item.product_name, item.quantity, item.unit_price_minor, item.line_total_minor, configured.commissionBasis, configured.commissionRateBps, commissions[index]]);
            const [stock] = await connection.query<ResultSetHeader>('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity >= ?', [item.quantity, item.product_id, item.quantity]);
            if (stock.affectedRows !== 1) throw new AppError(409, 'ORDER_ITEM_UNAVAILABLE', 'An item could not be reserved', { productId: item.product_id });
            await connection.query('INSERT INTO inventory_reservations (id, order_id, order_item_id, product_id, quantity, expires_at) VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL ? SECOND))', [randomUUID(), orderId, itemId, item.product_id, item.quantity, configured.reservationTtlSeconds]);
          }
        }
        await connection.query("INSERT INTO order_status_events (order_id, to_status, reason, actor_type, actor_user_id) VALUES (?, ?, 'order_created', ?, ?)", [orderId, initialStatus, owner.kind === 'customer' ? 'customer' : 'system', owner.kind === 'customer' ? owner.userId : null]);
        await connection.commit();
      }
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return { order: await this.orderView(orderId), idempotentReplay: replay, ...(guestTrackingToken ? { guestTrackingToken } : {}) };
  }

  public async getOrder(access: OrderAccess, orderId: string): Promise<object> {
    const [rows] = await this.pool.query<OrderRow[]>('SELECT * FROM orders WHERE id = ?', [orderId]);
    const order = rows[0];
    const allowed = order && (access.kind === 'customer' ? order.user_id === access.userId : order.guest_tracking_token_hash === hashToken(access.trackingToken));
    if (!allowed) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    return this.orderView(orderId);
  }

  public async transitionOrder(orderId: string, toStatus: OrderStatus, reason: string, actor: { type: 'system' | 'customer' | 'admin' | 'provider'; userId?: string }): Promise<object> {
    await this.applyTransition(orderId, toStatus, reason, actor, false);
    return this.orderView(orderId);
  }

  public async releaseExpiredReservations(limit = 100): Promise<number> {
    const [rows] = await this.pool.query<Array<RowDataPacket & { id: string }>>(`SELECT id FROM orders WHERE status IN ('awaiting_payment', 'awaiting_collection') AND reservation_expires_at <= NOW(3) ORDER BY reservation_expires_at LIMIT ?`, [limit]);
    let released = 0;
    for (const row of rows) if (await this.applyTransition(row.id, 'reservation_expired', 'reservation_timeout', { type: 'system' }, true)) released++;
    return released;
  }

  private async applyTransition(orderId: string, toStatus: OrderStatus, reason: string, actor: { type: 'system' | 'customer' | 'admin' | 'provider'; userId?: string }, ignoreRace: boolean): Promise<boolean> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [orders] = await connection.query<OrderRow[]>('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
      const order = orders[0];
      if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
      if (!(allowedTransitions[order.status] ?? []).includes(toStatus)) {
        if (ignoreRace) { await connection.commit(); return false; }
        throw new AppError(409, 'INVALID_ORDER_TRANSITION', `Order cannot transition from ${order.status} to ${toStatus}`);
      }
      if (toStatus === 'reservation_expired' && order.reservation_expires_at.getTime() > Date.now()) {
        if (ignoreRace) { await connection.commit(); return false; }
        throw new AppError(409, 'RESERVATION_NOT_EXPIRED', 'The inventory reservation has not expired');
      }
      if (releasableStatuses.has(order.status)) await this.releaseActiveReservations(connection, orderId, reason);
      await connection.query('UPDATE orders SET status = ? WHERE id = ?', [toStatus, orderId]);
      await connection.query('UPDATE seller_suborders SET status = ? WHERE order_id = ? AND status = ?', ['cancelled', orderId, 'pending']);
      await connection.query('INSERT INTO order_status_events (order_id, from_status, to_status, reason, actor_type, actor_user_id) VALUES (?, ?, ?, ?, ?, ?)', [orderId, order.status, toStatus, reason, actor.type, actor.userId ?? null]);
      await connection.commit();
      return true;
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  private async releaseActiveReservations(connection: PoolConnection, orderId: string, reason: string): Promise<void> {
    const [reservations] = await connection.query<ReservationRow[]>('SELECT * FROM inventory_reservations WHERE order_id = ? ORDER BY product_id FOR UPDATE', [orderId]);
    for (const reservation of reservations) {
      if (reservation.status !== 'active') continue;
      const [updated] = await connection.query<ResultSetHeader>("UPDATE inventory_reservations SET status = 'released', released_at = NOW(3), release_reason = ? WHERE id = ? AND status = 'active'", [reason, reservation.id]);
      if (updated.affectedRows === 1) await connection.query('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?', [reservation.quantity, reservation.product_id]);
    }
  }

  private async lockOwnedQuote(connection: PoolConnection, owner: OrderOwner, quoteId: string): Promise<QuoteOwnerRow> {
    const [rows] = await connection.query<QuoteOwnerRow[]>(`SELECT q.*, b.user_id, b.guest_token_hash, b.status AS basket_status, b.expires_at AS basket_expires_at FROM checkout_quotes q JOIN baskets b ON b.id = q.basket_id WHERE q.id = ? FOR UPDATE`, [quoteId]);
    const quote = rows[0];
    const owns = quote && quote.basket_status === 'active' && (owner.kind === 'customer' ? quote.user_id === owner.userId : quote.guest_token_hash === hashToken(owner.basketToken) && (!quote.basket_expires_at || quote.basket_expires_at.getTime() > Date.now()));
    if (!owns) throw new AppError(404, 'QUOTE_NOT_FOUND', 'Checkout quote not found');
    return quote;
  }

  private requireConfiguredPolicy(owner: OrderOwner, paymentMethod: PaymentMethod): Required<Pick<OrderPolicy, 'reservationTtlSeconds' | 'commissionBasis' | 'commissionRateBps'>> {
    const { reservationTtlSeconds, commissionBasis, commissionRateBps } = this.policy;
    if (reservationTtlSeconds === undefined || commissionBasis === undefined || commissionRateBps === undefined) throw new AppError(503, 'ORDER_POLICY_NOT_CONFIGURED', 'Order reservation and commission policy is not configured');
    if (paymentMethod === 'cod' && !this.policy.codEnabled) throw new AppError(409, 'COD_NOT_AVAILABLE', 'Cash on delivery is not enabled');
    if (owner.kind === 'guest' && !this.policy.guestTokenSecret) throw new AppError(503, 'GUEST_ORDER_CREDENTIALS_NOT_CONFIGURED', 'Guest order credential generation is not configured');
    return { reservationTtlSeconds, commissionBasis, commissionRateBps };
  }

  private guestTrackingToken(orderId: string, required: boolean): string | undefined {
    if (!this.policy.guestTokenSecret) {
      if (required) throw new AppError(503, 'GUEST_ORDER_CREDENTIALS_NOT_CONFIGURED', 'Guest order credential generation is not configured');
      return undefined;
    }
    return createHmac('sha256', this.policy.guestTokenSecret).update(`order:${orderId}`).digest('base64url');
  }

  private async orderView(orderId: string): Promise<object> {
    const [orders] = await this.pool.query<OrderRow[]>('SELECT * FROM orders WHERE id = ?', [orderId]);
    const order = orders[0];
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    const [[suborders], [items], [reservations]] = await Promise.all([
      this.pool.query<SuborderRow[]>('SELECT * FROM seller_suborders WHERE order_id = ? ORDER BY seller_id', [orderId]),
      this.pool.query<OrderItemRow[]>('SELECT * FROM order_items WHERE order_id = ? ORDER BY seller_id, product_id', [orderId]),
      this.pool.query<ReservationRow[]>('SELECT * FROM inventory_reservations WHERE order_id = ? ORDER BY product_id', [orderId])
    ]);
    return {
      id: order.id, quoteId: order.quote_id, paymentMethod: order.payment_method, status: order.status, currency: order.currency,
      deliveryMethod: order.delivery_method, destination: parsedJson(order.destination_snapshot),
      totals: { itemsSubtotalMinor: moneyValue(order.items_subtotal_minor), deliveryTotalMinor: moneyValue(order.delivery_total_minor), grandTotalMinor: moneyValue(order.grand_total_minor) },
      commissionPolicy: { basis: order.commission_basis, rateBps: order.commission_rate_bps },
      reservationExpiresAt: order.reservation_expires_at.toISOString(),
      suborders: suborders.map((suborder) => ({ id: suborder.id, sellerId: suborder.seller_id, status: suborder.status, itemsSubtotalMinor: moneyValue(suborder.items_subtotal_minor), deliveryFeeMinor: moneyValue(suborder.delivery_fee_minor), commissionMinor: moneyValue(suborder.commission_minor), sellerNetMinor: moneyValue(suborder.seller_net_minor), items: items.filter((item) => item.suborder_id === suborder.id).map(itemView) })),
      reservations: reservations.map((reservation) => ({ productId: reservation.product_id, quantity: reservation.quantity, status: reservation.status, expiresAt: reservation.expires_at.toISOString(), releasedAt: reservation.released_at?.toISOString() ?? null, releaseReason: reservation.release_reason })),
      createdAt: order.created_at.toISOString(), updatedAt: order.updated_at.toISOString()
    };
  }
}

function commissionAmount(lineTotal: number | string, rateBps: number): number {
  return moneyValue((BigInt(lineTotal) * BigInt(rateBps) + 5000n) / 10000n);
}

function itemView(item: OrderItemRow): object {
  return { id: item.id, productId: item.product_id, productName: item.product_name, quantity: item.quantity, unitPriceMinor: moneyValue(item.unit_price_minor), lineTotalMinor: moneyValue(item.line_total_minor), commission: { basis: item.commission_basis, rateBps: item.commission_rate_bps, amountMinor: moneyValue(item.commission_minor) } };
}

function jsonValue(value: string | object | null): string | null { return value === null ? null : typeof value === 'string' ? value : JSON.stringify(value); }
function parsedJson(value: string | object | null): object | null { return value === null ? null : typeof value === 'string' ? JSON.parse(value) as object : value; }
function isRetryableTransactionError(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT'); }
function retryDelay(attempt: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, 5 * (2 ** attempt) + Math.floor(Math.random() * 10))); }
