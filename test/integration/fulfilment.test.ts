import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { loadConfig } from '../../src/config.js';
import { createDatabasePool } from '../../src/database/pool.js';
import { migrate } from '../../src/database/migrate.js';
import { FulfilmentService } from '../../src/fulfilment/service.js';
import type { CreateRefundInput, ProviderRefund, RefundProvider } from '../../src/refunds/provider.js';

interface StatusRow extends RowDataPacket { status: string; stock_quantity?: number }
interface MoneyRow extends RowDataPacket { amount_minor: number | string; commission_reversal_minor?: number | string; seller_reversal_minor?: number | string; total?: number | string }

class FakeRefundProvider implements RefundProvider {
  public readonly creates: CreateRefundInput[] = [];
  public readonly results = new Map<string, ProviderRefund>();
  private sequence = 7000;

  public async create(input: CreateRefundInput): Promise<ProviderRefund> {
    this.creates.push(structuredClone(input));
    const result: ProviderRefund = { id: String(++this.sequence), status: 'pending', amountMinor: input.amountMinor, currency: input.currency, transactionReference: input.transactionReference, processedAt: null };
    this.results.set(result.id, result);
    return structuredClone(result);
  }

  public async fetch(providerRefundId: string): Promise<ProviderRefund> {
    const result = this.results.get(providerRefundId);
    if (!result) throw new Error('synthetic refund missing');
    return structuredClone(result);
  }

  public process(providerRefundId: string): void {
    const current = this.results.get(providerRefundId)!;
    this.results.set(providerRefundId, { ...current, status: 'processed', processedAt: new Date('2026-10-27T12:00:00.000Z') });
  }
}

describe('B08 fulfilment, returns, refunds, and COD reconciliation against MariaDB', function () {
  this.timeout(40_000);
  let pool: Pool;
  let service: FulfilmentService;
  const provider = new FakeRefundProvider();
  const customerId = '81000000-0000-4000-8000-000000000001';
  const adminId = '81000000-0000-4000-8000-000000000002';
  const sellerUser1 = '81000000-0000-4000-8000-000000000003';
  const sellerUser2 = '81000000-0000-4000-8000-000000000004';
  const seller1 = '82000000-0000-4000-8000-000000000001';
  const seller2 = '82000000-0000-4000-8000-000000000002';
  const product1 = '83000000-0000-4000-8000-000000000001';
  const product2 = '83000000-0000-4000-8000-000000000002';
  const basketId = '84000000-0000-4000-8000-000000000001';

  before(async () => {
    process.env.EMAIL_PROVIDER = 'fake';
    const config = loadConfig();
    assert.equal(config.NODE_ENV, 'test');
    assert.match(config.DATABASE_NAME, /_test$/);
    await migrate('down');
    await migrate('up');
    pool = createDatabasePool(config);
    service = new FulfilmentService(pool, provider, { returnWindowDays: 14, refundDeliveryMode: 'full_order' });
    await seedBase();
  });

  after(async () => { if (pool) await pool.end(); });

  async function seedBase(): Promise<void> {
    for (const [id, email] of [[customerId, 'b08.customer@example.test'], [adminId, 'b08.admin@example.test'], [sellerUser1, 'b08.seller1@example.test'], [sellerUser2, 'b08.seller2@example.test']] as const) {
      await pool.query('INSERT INTO users (id, email, password_hash, display_name, email_verified_at) VALUES (?, ?, ?, ?, NOW(3))', [id, email, 'synthetic', email]);
    }
    await pool.query("INSERT INTO user_roles (user_id, role) VALUES (?, 'customer'), (?, 'admin'), (?, 'seller'), (?, 'seller')", [customerId, adminId, sellerUser1, sellerUser2]);
    await pool.query("INSERT INTO sellers (id, user_id, business_name, phone, identity_status, approval_status, approved_at) VALUES (?, ?, 'B08 Seller One', '+2348000000801', 'verified', 'approved', NOW(3)), (?, ?, 'B08 Seller Two', '+2348000000802', 'verified', 'approved', NOW(3))", [seller1, sellerUser1, seller2, sellerUser2]);
    await pool.query("INSERT INTO categories (id, name, slug) VALUES ('85000000-0000-4000-8000-000000000001', 'B08 Fixtures', 'b08-fixtures')");
    await pool.query("INSERT INTO products (id, seller_id, category_id, name, slug, description, price_minor, publication_status, stock_quantity, published_at) VALUES (?, ?, '85000000-0000-4000-8000-000000000001', 'B08 Wig One', 'b08-wig-one', 'fixture', 100000, 'published', 20, NOW(3)), (?, ?, '85000000-0000-4000-8000-000000000001', 'B08 Wig Two', 'b08-wig-two', 'fixture', 150000, 'published', 20, NOW(3))", [product1, seller1, product2, seller2]);
    await pool.query('INSERT INTO baskets (id, user_id) VALUES (?, ?)', [basketId, customerId]);
  }

  async function makeOrder(input: { status: string; paymentMethod: 'paystack' | 'cod'; deliveryMethod?: 'delivery' | 'pickup'; items: Array<{ sellerId: string; productId: string; quantity: number; status?: string }>; suffix: number; reservationStatus?: 'active' | 'consumed' }): Promise<{ orderId: string; itemIds: string[]; suborderIds: string[]; paymentId?: string; reference?: string }> {
    const orderId = randomUUID();
    const quoteId = randomUUID();
    const deliveryMethod = input.deliveryMethod ?? 'delivery';
    const subtotal = input.items.reduce((total, item) => total + (item.productId === product1 ? 100000 : 150000) * item.quantity, 0);
    const delivery = 5000;
    await pool.query(`INSERT INTO checkout_quotes (id, basket_id, idempotency_key, request_hash, delivery_method, destination_snapshot, items_subtotal_minor, delivery_total_minor, grand_total_minor, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL 1 DAY))`, [quoteId, basketId, `b08-quote-${input.suffix}`, createHash('sha256').update(String(input.suffix)).digest('hex'), deliveryMethod, JSON.stringify({ method: deliveryMethod, estimate: { minBusinessDays: 1, maxBusinessDays: 3 } }), subtotal, delivery, subtotal + delivery]);
    await pool.query(`INSERT INTO orders (id, quote_id, basket_id, user_id, idempotency_key, request_hash, payment_method, status, delivery_method, destination_snapshot, items_subtotal_minor, delivery_total_minor, grand_total_minor, commission_basis, commission_rate_bps, reservation_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'line_item_gross', 1000, DATE_ADD(NOW(3), INTERVAL 1 DAY))`, [orderId, quoteId, basketId, customerId, `b08-order-${input.suffix}`, createHash('sha256').update(`order-${input.suffix}`).digest('hex'), input.paymentMethod, input.status, deliveryMethod, JSON.stringify({ method: deliveryMethod, estimate: { minBusinessDays: 1, maxBusinessDays: 3 } }), subtotal, delivery, subtotal + delivery]);
    const itemIds: string[] = [];
    const suborderIds: string[] = [];
    for (const [index, source] of input.items.entries()) {
      const suborderId = randomUUID(); const itemId = randomUUID(); const reservationId = randomUUID();
      const unit = source.productId === product1 ? 100000 : 150000;
      const gross = unit * source.quantity; const commission = gross / 10;
      const status = source.status ?? 'pending';
      await pool.query(`INSERT INTO seller_suborders (id, order_id, seller_id, status, items_subtotal_minor, delivery_fee_minor, commission_minor, seller_net_minor, fulfilled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? IN ('delivered','picked_up') THEN NOW(3) ELSE NULL END)`, [suborderId, orderId, source.sellerId, status, gross, index === 0 ? delivery : 0, commission, gross - commission, status]);
      await pool.query(`INSERT INTO order_items (id, order_id, suborder_id, product_id, seller_id, product_name, quantity, unit_price_minor, line_total_minor, commission_basis, commission_rate_bps, commission_minor) VALUES (?, ?, ?, ?, ?, 'B08 fixture item', ?, ?, ?, 'line_item_gross', 1000, ?)`, [itemId, orderId, suborderId, source.productId, source.sellerId, source.quantity, unit, gross, commission]);
      await pool.query('INSERT INTO inventory_reservations (id, order_id, order_item_id, product_id, quantity, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL 1 DAY))', [reservationId, orderId, itemId, source.productId, source.quantity, input.reservationStatus ?? (input.status === 'paid' || input.status === 'delivered' ? 'consumed' : 'active')]);
      itemIds.push(itemId); suborderIds.push(suborderId);
    }
    if (input.paymentMethod === 'paystack' && !['awaiting_payment', 'payment_failed'].includes(input.status)) {
      const paymentId = randomUUID(); const reference = `LH-B08-${input.suffix}`;
      await pool.query("INSERT INTO payments (id, order_id, provider_reference, provider_transaction_id, customer_email, expected_amount_minor, currency, status, paid_at, verified_at) VALUES (?, ?, ?, ?, 'b08.customer@example.test', ?, 'NGN', 'succeeded', NOW(3), NOW(3))", [paymentId, orderId, reference, String(9000 + input.suffix), subtotal + delivery]);
      await pool.query("INSERT INTO payment_ledger_entries (id, order_id, payment_id, logical_key, entry_type, direction, amount_minor, currency, description) VALUES (?, ?, ?, ?, 'payment_received', 'credit', ?, 'NGN', 'fixture payment')", [randomUUID(), orderId, paymentId, `${paymentId}:payment_received`, subtotal + delivery]);
      return { orderId, itemIds, suborderIds, paymentId, reference };
    }
    return { orderId, itemIds, suborderIds };
  }

  it('rejects delivery jumps and cannot let one seller alter another seller portion', async () => {
    const order = await makeOrder({ status: 'paid', paymentMethod: 'paystack', suffix: 1, items: [{ sellerId: seller1, productId: product1, quantity: 1 }, { sellerId: seller2, productId: product2, quantity: 1 }] });
    await assert.rejects(service.transitionSeller(sellerUser1, order.orderId, 'shipped'), (error: Error & { code?: string }) => error.code === 'INVALID_FULFILMENT_TRANSITION');
    await service.transitionSeller(sellerUser1, order.orderId, 'processing');
    const [rows] = await pool.query<StatusRow[]>('SELECT status FROM seller_suborders WHERE order_id = ? ORDER BY seller_id', [order.orderId]);
    assert.deepEqual(rows.map((row) => row.status), ['processing', 'pending']);
    const otherOnly = await makeOrder({ status: 'paid', paymentMethod: 'paystack', suffix: 2, items: [{ sellerId: seller2, productId: product2, quantity: 1 }] });
    await assert.rejects(service.transitionSeller(sellerUser1, otherOnly.orderId, 'processing'), (error: Error & { code?: string }) => error.code === 'SUBORDER_NOT_FOUND');
  });

  it('cancels an unprocessed COD order and releases stock exactly once', async () => {
    const order = await makeOrder({ status: 'awaiting_collection', paymentMethod: 'cod', suffix: 3, items: [{ sellerId: seller1, productId: product1, quantity: 2 }], reservationStatus: 'active' });
    const [before] = await pool.query<Array<RowDataPacket & { stock_quantity: number }>>('SELECT stock_quantity FROM products WHERE id = ?', [product1]);
    await service.cancelOrder({ kind: 'customer', userId: customerId }, order.orderId, 'Customer changed mind');
    await service.cancelOrder({ kind: 'customer', userId: customerId }, order.orderId, 'Customer changed mind');
    const [after] = await pool.query<Array<RowDataPacket & { stock_quantity: number }>>('SELECT stock_quantity FROM products WHERE id = ?', [product1]);
    assert.equal(after[0]!.stock_quantity, before[0]!.stock_quantity + 2);
    const [reservation] = await pool.query<StatusRow[]>('SELECT status FROM inventory_reservations WHERE order_id = ?', [order.orderId]);
    assert.equal(reservation[0]!.status, 'released');
  });

  it('keeps COD earnings ineligible until exact collection is confirmed', async () => {
    const order = await makeOrder({ status: 'delivered', paymentMethod: 'cod', suffix: 4, items: [{ sellerId: seller1, productId: product1, quantity: 1, status: 'delivered' }] });
    await assert.rejects(service.recordCodCollection(adminId, order.orderId, 1, 'COD-WRONG-4', new Date(), 'cod-key-0004'), (error: Error & { code?: string }) => error.code === 'COD_COLLECTION_AMOUNT_MISMATCH');
    const recorded = await service.recordCodCollection(adminId, order.orderId, 105000, 'COD-B08-4', new Date('2026-10-27T10:00:00.000Z'), 'cod-key-0004');
    assert.equal((recorded.collection as { earningsEligible: boolean }).earningsEligible, false);
    const confirmed = await service.reconcileCodCollection(adminId, (recorded.collection as { id: string }).id, 'confirm', 'Cash matched dispatch record');
    assert.equal((confirmed as { earningsEligible: boolean }).earningsEligible, true);
  });

  it('deduplicates return requests and leaves delayed partial refunds pending', async () => {
    const order = await makeOrder({ status: 'delivered', paymentMethod: 'paystack', suffix: 5, items: [{ sellerId: seller1, productId: product1, quantity: 2, status: 'delivered' }] });
    const input = [{ orderItemId: order.itemIds[0]!, quantity: 1 }];
    const first = await service.requestReturn({ kind: 'customer', userId: customerId }, order.orderId, input, 'Item differs from description', 'return-key-0005');
    const replay = await service.requestReturn({ kind: 'customer', userId: customerId }, order.orderId, input, 'Item differs from description', 'return-key-0005');
    assert.equal(replay.idempotentReplay, true);
    const returnId = (first.returnRequest as { id: string }).id;
    const reviewed = await service.reviewReturn(adminId, returnId, 'approve', 'Approved after inspection', 'restock') as { refund: { id: string; providerRefundId: string; status: string } };
    assert.equal(reviewed.refund.status, 'pending');
    assert.equal(provider.creates.at(-1)!.amountMinor, 100000);
    const calls = provider.creates.length;
    await service.reviewReturn(adminId, returnId, 'approve', 'Approved after inspection', 'restock');
    assert.equal(provider.creates.length, calls);
    const [ledger] = await pool.query<MoneyRow[]>("SELECT COUNT(*) AS total FROM payment_ledger_entries WHERE entry_type = 'refund_processed' AND refund_id = ?", [reviewed.refund.id]);
    assert.equal(Number(ledger[0]!.total), 0);
  });

  it('reconciles partial then full refunds with exact commission reversals and one ledger debit each', async () => {
    const order = await makeOrder({ status: 'delivered', paymentMethod: 'paystack', suffix: 6, items: [{ sellerId: seller1, productId: product1, quantity: 2, status: 'delivered' }] });
    const firstRequest = await service.requestReturn({ kind: 'customer', userId: customerId }, order.orderId, [{ orderItemId: order.itemIds[0]!, quantity: 1 }], 'First unit returned', 'return-key-0006a');
    const firstReviewed = await service.reviewReturn(adminId, (firstRequest.returnRequest as { id: string }).id, 'approve', 'First unit inspected', 'restock') as { refund: { id: string; providerRefundId: string } };
    provider.process(firstReviewed.refund.providerRefundId);
    await service.reconcileRefund(firstReviewed.refund.id);
    const secondRequest = await service.requestReturn({ kind: 'customer', userId: customerId }, order.orderId, [{ orderItemId: order.itemIds[0]!, quantity: 1 }], 'Second unit returned', 'return-key-0006b');
    const secondReviewed = await service.reviewReturn(adminId, (secondRequest.returnRequest as { id: string }).id, 'approve', 'Second unit inspected', 'no_restock') as { refund: { id: string; providerRefundId: string; amountMinor: number } };
    assert.equal(secondReviewed.refund.amountMinor, 105000);
    provider.process(secondReviewed.refund.providerRefundId);
    await service.reconcileRefund(secondReviewed.refund.id);
    const [adjustments] = await pool.query<MoneyRow[]>('SELECT SUM(commission_reversal_minor) AS commission_reversal_minor, SUM(seller_reversal_minor) AS seller_reversal_minor FROM seller_refund_adjustments WHERE refund_id IN (?, ?)', [firstReviewed.refund.id, secondReviewed.refund.id]);
    assert.equal(Number(adjustments[0]!.commission_reversal_minor), 20000);
    assert.equal(Number(adjustments[0]!.seller_reversal_minor), 180000);
    const [debits] = await pool.query<MoneyRow[]>("SELECT COUNT(*) AS total, SUM(amount_minor) AS amount_minor FROM payment_ledger_entries WHERE payment_id = ? AND entry_type = 'refund_processed'", [order.paymentId]);
    assert.equal(Number(debits[0]!.total), 2);
    assert.equal(Number(debits[0]!.amount_minor), 205000);
    const [status] = await pool.query<StatusRow[]>('SELECT status FROM orders WHERE id = ?', [order.orderId]);
    assert.equal(status[0]!.status, 'refunded');
  });

  it('creates one controlled refund for a late-payment review case', async () => {
    const order = await makeOrder({ status: 'reservation_expired', paymentMethod: 'paystack', suffix: 7, items: [{ sellerId: seller1, productId: product1, quantity: 1, status: 'cancelled' }] });
    await pool.query("UPDATE payments SET status = 'late_success' WHERE id = ?", [order.paymentId]);
    const reviewId = randomUUID();
    await pool.query("INSERT INTO payment_review_cases (id, order_id, payment_id, case_type, details) VALUES (?, ?, ?, 'late_payment', ?)", [reviewId, order.orderId, order.paymentId, JSON.stringify({ fixture: true })]);
    const first = await service.refundLatePayment(adminId, reviewId) as { id: string; providerRefundId: string };
    const calls = provider.creates.length;
    const replay = await service.refundLatePayment(adminId, reviewId) as { id: string };
    assert.equal(replay.id, first.id);
    assert.equal(provider.creates.length, calls);
    provider.process(first.providerRefundId);
    await service.reconcileRefund(first.id);
    const [status] = await pool.query<StatusRow[]>('SELECT status FROM payment_review_cases WHERE id = ?', [reviewId]);
    assert.equal(status[0]!.status, 'resolved');
  });

  it('processes and deduplicates an unambiguous refund webhook', async () => {
    const order = await makeOrder({ status: 'delivered', paymentMethod: 'paystack', suffix: 8, items: [{ sellerId: seller2, productId: product2, quantity: 1, status: 'delivered' }] });
    const requested = await service.requestReturn({ kind: 'customer', userId: customerId }, order.orderId, [{ orderItemId: order.itemIds[0]!, quantity: 1 }], 'Webhook refund fixture', 'return-key-0008');
    const reviewed = await service.reviewReturn(adminId, (requested.returnRequest as { id: string }).id, 'approve', 'Approved webhook fixture', 'no_restock') as { refund: { id: string; providerRefundId: string; amountMinor: number } };
    const raw = Buffer.from(JSON.stringify({ event: 'refund.processed', data: { transaction_reference: order.reference, refund_reference: reviewed.refund.providerRefundId, amount: String(reviewed.refund.amountMinor), currency: 'NGN', status: 'processed' } }));
    const event = { event: 'refund.processed', data: { transaction_reference: order.reference, refund_reference: reviewed.refund.providerRefundId, amount: String(reviewed.refund.amountMinor), currency: 'NGN', status: 'processed' } };
    const first = await service.handleRefundWebhook(event, raw) as { duplicate: boolean };
    const duplicate = await service.handleRefundWebhook(event, raw) as { duplicate: boolean };
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    const [ledger] = await pool.query<MoneyRow[]>("SELECT COUNT(*) AS total FROM payment_ledger_entries WHERE refund_id = ? AND entry_type = 'refund_processed'", [reviewed.refund.id]);
    assert.equal(Number(ledger[0]!.total), 1);
  });
});
