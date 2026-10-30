import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import pino from 'pino';
import request from 'supertest';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDatabasePool } from '../../src/database/pool.js';
import { migrate } from '../../src/database/migrate.js';

interface CounterRow extends RowDataPacket { paid_units_sold: number | string }

describe('B10 reviews, merchandising, and reporting against MariaDB', function () {
  this.timeout(40_000);
  let pool: Pool;
  let api: ReturnType<typeof request>;
  let customerToken: string; let otherCustomerToken: string; let adminToken: string; let financeToken: string; let supportToken: string;
  const password = 'ValidPass123!';
  const customerId = 'a1000000-0000-4000-8000-000000000001';
  const otherCustomerId = 'a1000000-0000-4000-8000-000000000002';
  const adminId = 'a1000000-0000-4000-8000-000000000003';
  const financeId = 'a1000000-0000-4000-8000-000000000004';
  const supportId = 'a1000000-0000-4000-8000-000000000005';
  const sellerUserId = 'a1000000-0000-4000-8000-000000000006';
  const sellerId = 'a2000000-0000-4000-8000-000000000001';
  const categoryId = 'a3000000-0000-4000-8000-000000000001';
  const productOneId = 'a4000000-0000-4000-8000-000000000001';
  const productTwoId = 'a4000000-0000-4000-8000-000000000002';
  const paidOrderId = 'a5000000-0000-4000-8000-000000000001';
  const paidItemId = 'a6000000-0000-4000-8000-000000000001';
  const paidSuborderId = 'a7000000-0000-4000-8000-000000000001';
  const codOrderId = 'a5000000-0000-4000-8000-000000000002';
  const codCollectionId = 'a8000000-0000-4000-8000-000000000001';

  before(async () => {
    process.env.EMAIL_PROVIDER = 'fake';
    const config = loadConfig();
    assert.equal(config.NODE_ENV, 'test'); assert.match(config.DATABASE_NAME, /_test$/);
    await migrate('down'); await migrate('up');
    pool = createDatabasePool(config);
    api = request(createApp({ pool, logger: pino({ level: 'silent' }), readinessTimeoutMs: 100 }));
    await seed();
    customerToken = await login('b10.customer@example.test');
    otherCustomerToken = await login('b10.other@example.test');
    adminToken = await login('b10.admin@example.test');
    financeToken = await login('b10.finance@example.test');
    supportToken = await login('b10.support@example.test');
  });
  after(async () => { if (pool) await pool.end(); });

  async function seed(): Promise<void> {
    const hash = await argon2.hash(password);
    const users = [
      [customerId, 'b10.customer@example.test', 'B10 Customer', 'customer'], [otherCustomerId, 'b10.other@example.test', 'B10 Other Customer', 'customer'],
      [adminId, 'b10.admin@example.test', 'B10 Admin', 'admin'], [financeId, 'b10.finance@example.test', 'B10 Finance', 'finance'],
      [supportId, 'b10.support@example.test', 'B10 Support', 'support'], [sellerUserId, 'b10.seller@example.test', 'B10 Seller', 'seller']
    ] as const;
    for (const [id, email, name, role] of users) {
      await pool.query('INSERT INTO users (id, email, password_hash, display_name, email_verified_at) VALUES (?, ?, ?, ?, NOW(3))', [id, email, hash, name]);
      await pool.query('INSERT INTO user_roles (user_id, role) VALUES (?, ?)', [id, role]);
    }
    await pool.query("INSERT INTO sellers (id, user_id, business_name, phone, identity_status, approval_status, approved_at) VALUES (?, ?, 'B10 Seller', '+2348000001000', 'verified', 'approved', NOW(3))", [sellerId, sellerUserId]);
    await pool.query("INSERT INTO categories (id, name, slug) VALUES (?, 'B10 Category', 'b10-category')", [categoryId]);
    await pool.query("INSERT INTO products (id, seller_id, category_id, name, slug, description, price_minor, publication_status, stock_quantity, paid_units_sold, published_at) VALUES (?, ?, ?, '=HYPERLINK(\"https://invalid.example\")', 'b10-formula-product', 'B10 report formula fixture', 100000, 'published', 10, 2, NOW(3)), (?, ?, ?, 'B10 Related Product', 'b10-related-product', 'B10 related product fixture', 50000, 'published', 10, 0, NOW(3))", [productOneId, sellerId, categoryId, productTwoId, sellerId, categoryId]);
    await insertOrder({ suffix: 'paid', userId: customerId, orderId: paidOrderId, suborderId: paidSuborderId, itemId: paidItemId, productId: productOneId, productName: '=HYPERLINK("https://invalid.example")', quantity: 2, unitMinor: 100000, deliveryMinor: 5000, method: 'paystack' });
    const cod = await insertOrder({ suffix: 'cod', userId: otherCustomerId, orderId: codOrderId, suborderId: randomUUID(), itemId: randomUUID(), productId: productTwoId, productName: 'B10 Related Product', quantity: 3, unitMinor: 50000, deliveryMinor: 5000, method: 'cod' });
    await pool.query("INSERT INTO cod_collections (id, order_id, idempotency_key, request_hash, amount_minor, collection_reference, status, collected_at, recorded_by) VALUES (?, ?, 'b10-cod-key', ?, ?, 'COD-B10-001', 'recorded', NOW(3), ?)", [codCollectionId, codOrderId, createHash('sha256').update('b10-cod').digest('hex'), cod.totalMinor, adminId]);

    const returnId = randomUUID(); const returnItemId = randomUUID(); const refundId = randomUUID(); const adjustmentId = randomUUID();
    await pool.query("INSERT INTO return_requests (id, order_id, idempotency_key, request_hash, reason, status, requested_by_user_id, reviewed_by, reviewed_at) VALUES (?, ?, 'b10-return-key', ?, 'Synthetic reporting refund', 'refunded', ?, ?, NOW(3))", [returnId, paidOrderId, createHash('sha256').update('b10-return').digest('hex'), customerId, adminId]);
    await pool.query("INSERT INTO return_request_items (id, return_request_id, order_item_id, quantity, item_refund_minor, commission_reversal_minor, seller_reversal_minor, stock_disposition) VALUES (?, ?, ?, 1, 100000, 10000, 90000, 'no_restock')", [returnItemId, returnId, paidItemId]);
    await pool.query("INSERT INTO refunds (id, return_request_id, payment_id, provider_refund_id, amount_minor, delivery_refund_minor, status, initiated_by, processed_at) VALUES (?, ?, ?, 'B10REFUND1', 100000, 0, 'processed', ?, NOW(3))", [refundId, returnId, 'a9000000-0000-4000-8000-000000000001', adminId]);
    await pool.query("INSERT INTO seller_refund_adjustments (id, refund_id, seller_id, suborder_id, item_gross_reversal_minor, commission_reversal_minor, seller_reversal_minor, classification, classified_at) VALUES (?, ?, ?, ?, 100000, 10000, 90000, 'earnings_reversal', NOW(3))", [adjustmentId, refundId, sellerId, paidSuborderId]);

    const recipientId = randomUUID(); const payoutId = randomUUID();
    await pool.query("INSERT INTO seller_payout_recipients (id, seller_id, provider_recipient_code, account_name, bank_name, account_last4, configured_by) VALUES (?, ?, 'RCP_B10TEST', 'B10 Seller', 'Synthetic Bank', '0010', ?)", [recipientId, sellerId, financeId]);
    await pool.query("INSERT INTO payouts (id, seller_id, payout_recipient_id, requested_by, idempotency_key, request_hash, provider_reference, provider_transfer_code, amount_minor, status, initiated_at, concluded_at) VALUES (?, ?, ?, ?, 'b10-payout-key', ?, 'lh_payout_b10fixture', 'TRF_B10', 50000, 'success', NOW(3), NOW(3))", [payoutId, sellerId, recipientId, financeId, createHash('sha256').update('b10-payout').digest('hex')]);
    const ledger = async (key: string, entry: string, bucket: string, direction: string, amount: number, refs: { adjustment?: string; payout?: string } = {}): Promise<void> => {
      await pool.query('INSERT INTO seller_ledger_entries (id, seller_id, suborder_id, refund_adjustment_id, payout_id, logical_key, entry_type, bucket, direction, amount_minor, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [randomUUID(), sellerId, paidSuborderId, refs.adjustment ?? null, refs.payout ?? null, key, entry, bucket, direction, amount, 'B10 reporting fixture']);
    };
    await ledger('b10:earning:held', 'earning_held', 'held', 'credit', 180000);
    await ledger('b10:release:held', 'hold_released', 'held', 'debit', 180000);
    await ledger('b10:release:available', 'hold_released', 'available', 'credit', 180000);
    await ledger('b10:refund:available', 'refund_reversal', 'available', 'debit', 90000, { adjustment: adjustmentId });
    await ledger('b10:payout:available', 'payout_reserved', 'available', 'debit', 50000, { payout: payoutId });
    await ledger('b10:payout:reserved', 'payout_reserved', 'reserved', 'credit', 50000, { payout: payoutId });
    await ledger('b10:payout:reserved-paid', 'payout_paid', 'reserved', 'debit', 50000, { payout: payoutId });
    await ledger('b10:payout:paid', 'payout_paid', 'paid', 'credit', 50000, { payout: payoutId });
  }

  async function insertOrder(input: { suffix: string; userId: string; orderId: string; suborderId: string; itemId: string; productId: string; productName: string; quantity: number; unitMinor: number; deliveryMinor: number; method: 'paystack' | 'cod' }): Promise<{ totalMinor: number }> {
    const basketId = randomUUID(); const quoteId = randomUUID(); const subtotal = input.unitMinor * input.quantity; const total = subtotal + input.deliveryMinor;
    await pool.query('INSERT INTO baskets (id, user_id) VALUES (?, ?)', [basketId, input.userId]);
    await pool.query("INSERT INTO checkout_quotes (id, basket_id, idempotency_key, request_hash, delivery_method, destination_snapshot, items_subtotal_minor, delivery_total_minor, grand_total_minor, expires_at) VALUES (?, ?, ?, ?, 'delivery', ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL 1 DAY))", [quoteId, basketId, `b10-quote-${input.suffix}`, createHash('sha256').update(`quote-${input.suffix}`).digest('hex'), JSON.stringify({ method: 'delivery' }), subtotal, input.deliveryMinor, total]);
    await pool.query("INSERT INTO orders (id, quote_id, basket_id, user_id, idempotency_key, request_hash, payment_method, status, delivery_method, destination_snapshot, items_subtotal_minor, delivery_total_minor, grand_total_minor, commission_basis, commission_rate_bps, reservation_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'delivered', 'delivery', ?, ?, ?, ?, 'line_item_gross', 1000, DATE_ADD(NOW(3), INTERVAL 1 DAY))", [input.orderId, quoteId, basketId, input.userId, `b10-order-${input.suffix}`, createHash('sha256').update(`order-${input.suffix}`).digest('hex'), input.method, JSON.stringify({ method: 'delivery' }), subtotal, input.deliveryMinor, total]);
    const commission = subtotal / 10;
    await pool.query("INSERT INTO seller_suborders (id, order_id, seller_id, status, items_subtotal_minor, delivery_fee_minor, commission_minor, seller_net_minor, fulfilled_at) VALUES (?, ?, ?, 'delivered', ?, ?, ?, ?, NOW(3))", [input.suborderId, input.orderId, sellerId, subtotal, input.deliveryMinor, commission, subtotal - commission]);
    await pool.query("INSERT INTO order_items (id, order_id, suborder_id, product_id, seller_id, product_name, quantity, unit_price_minor, line_total_minor, commission_basis, commission_rate_bps, commission_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'line_item_gross', 1000, ?)", [input.itemId, input.orderId, input.suborderId, input.productId, sellerId, input.productName, input.quantity, input.unitMinor, subtotal, commission]);
    if (input.method === 'paystack') await pool.query("INSERT INTO payments (id, order_id, provider_reference, provider_transaction_id, customer_email, expected_amount_minor, currency, status, paid_at, verified_at) VALUES ('a9000000-0000-4000-8000-000000000001', ?, 'LH-B10-PAID', '101001', 'b10.customer@example.test', ?, 'NGN', 'succeeded', NOW(3), NOW(3))", [input.orderId, total]);
    return { totalMinor: total };
  }

  async function login(email: string): Promise<string> {
    const response = await api.post('/api/v1/auth/login').send({ email, password }).expect(200);
    return response.body.data.tokens.accessToken as string;
  }

  it('allows only a completed purchaser to submit one idempotent review and moderation controls public visibility', async () => {
    const body = { orderItemId: paidItemId, rating: 5, title: 'Excellent quality', body: 'The synthetic product matched its description.' };
    await api.post('/api/v1/reviews').set('authorization', `Bearer ${otherCustomerToken}`).set('idempotency-key', 'b10-review-other').send(body).expect(403);
    const created = await api.post('/api/v1/reviews').set('authorization', `Bearer ${customerToken}`).set('idempotency-key', 'b10-review-customer').send(body).expect(201);
    const reviewId = created.body.data.review.id as string;
    const replay = await api.post('/api/v1/reviews').set('authorization', `Bearer ${customerToken}`).set('idempotency-key', 'b10-review-customer').send(body).expect(200);
    assert.equal(replay.body.data.idempotentReplay, true);
    assert.equal((await api.get(`/api/v1/products/${productOneId}/reviews`).expect(200)).body.data.reviews.length, 0);
    await api.patch(`/api/v1/admin/reviews/${reviewId}`).set('authorization', `Bearer ${adminToken}`).send({ status: 'published', reason: 'Verified purchase and appropriate content' }).expect(200);
    assert.equal((await api.get(`/api/v1/products/${productOneId}/reviews`).expect(200)).body.data.reviews.length, 1);
    await api.patch(`/api/v1/admin/reviews/${reviewId}`).set('authorization', `Bearer ${adminToken}`).send({ status: 'rejected', reason: 'Synthetic moderation visibility check' }).expect(200);
    assert.equal((await api.get(`/api/v1/products/${productOneId}/reviews`).expect(200)).body.data.reviews.length, 0);
  });

  it('increments COD popularity once and preserves category-based related ordering', async () => {
    await api.patch(`/api/v1/admin/cod-collections/${codCollectionId}`).set('authorization', `Bearer ${adminToken}`).send({ action: 'confirm', note: 'Synthetic B10 collection confirmed' }).expect(200);
    await api.patch(`/api/v1/admin/cod-collections/${codCollectionId}`).set('authorization', `Bearer ${adminToken}`).send({ action: 'confirm', note: 'Duplicate confirmation' }).expect(409);
    const [counter] = await pool.query<CounterRow[]>('SELECT paid_units_sold FROM products WHERE id = ?', [productTwoId]);
    assert.equal(Number(counter[0]!.paid_units_sold), 3);
    const related = await api.get(`/api/v1/products/${productOneId}/related`).expect(200);
    assert.equal(related.body.data.products[0].id, productTwoId);
    const popular = await api.get('/api/v1/products').query({ sort: 'popularity' }).expect(200);
    assert.equal(popular.body.data.products[0].id, productTwoId);
  });

  it('shows only active banners and keeps banner management admin-only', async () => {
    await api.post('/api/v1/admin/banners').set('authorization', `Bearer ${supportToken}`).send({ title: 'Blocked Banner', imageUrl: '/blocked.png' }).expect(403);
    const created = await api.post('/api/v1/admin/banners').set('authorization', `Bearer ${adminToken}`).send({ title: 'B10 Home Banner', imageUrl: '/images/b10-banner.png', targetUrl: '/products', position: 1, status: 'active' }).expect(201);
    const banners = await api.get('/api/v1/banners').expect(200);
    assert.equal(banners.body.data.banners[0].id, created.body.data.banner.id);
  });

  it('separates finance and support permissions and reconciles financial reports to ledger fixtures', async () => {
    await api.get('/api/v1/admin/reports/sales').set('authorization', `Bearer ${supportToken}`).expect(403);
    const sales = await api.get('/api/v1/admin/reports/sales').set('authorization', `Bearer ${financeToken}`).expect(200);
    assert.equal(sales.headers['cache-control'], 'no-store');
    assert.equal(sales.body.data.totals.grossSalesMinor, '360000'); assert.equal(sales.body.data.totals.unitsSold, '5');
    const refunds = await api.get('/api/v1/admin/reports/refunds').set('authorization', `Bearer ${financeToken}`).expect(200);
    assert.equal(refunds.body.data.totals.refundMinor, '100000');
    const commissions = await api.get('/api/v1/admin/reports/commissions').set('authorization', `Bearer ${financeToken}`).expect(200);
    assert.equal(commissions.body.data.totals.grossCommissionMinor, '35000'); assert.equal(commissions.body.data.totals.netCommissionMinor, '25000');
    const earnings = await api.get('/api/v1/admin/reports/earnings').set('authorization', `Bearer ${financeToken}`).expect(200);
    assert.equal(earnings.body.data.totals.earnedMinor, '180000'); assert.equal(earnings.body.data.totals.netEarnedMinor, '90000');
    const payouts = await api.get('/api/v1/admin/reports/payouts').set('authorization', `Bearer ${financeToken}`).expect(200);
    assert.equal(payouts.body.data.totals.successfulMinor, '50000'); assert.equal(payouts.body.data.totals.ledgerPaidMinor, '50000');
  });

  it('neutralizes formula-like product names in CSV exports', async () => {
    const response = await api.get('/api/v1/admin/reports/products').query({ format: 'csv' }).set('authorization', `Bearer ${financeToken}`).expect(200).expect('content-type', /text\/csv/);
    assert.match(response.text, /"'=HYPERLINK\(""https:\/\/invalid\.example""\)"/);
    assert.doesNotMatch(response.text, /,"=HYPERLINK/);
  });
});
