import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { loadConfig } from '../../src/config.js';
import { createDatabasePool } from '../../src/database/pool.js';
import { migrate } from '../../src/database/migrate.js';
import { PaymentProviderError } from '../../src/payments/provider.js';
import type { InitiateTransferInput, ProviderTransfer, TransferProvider } from '../../src/payouts/provider.js';
import { EarningsPayoutService } from '../../src/payouts/service.js';

class FakeTransferProvider implements TransferProvider {
  public initiations: InitiateTransferInput[] = [];
  public verifications: string[] = [];
  public initiateMode: 'failed' | 'timeout' | 'pending' = 'pending';
  public verifyStatus = 'success';
  public async initiate(input: InitiateTransferInput): Promise<ProviderTransfer> {
    this.initiations.push(structuredClone(input));
    if (this.initiateMode === 'timeout') throw new PaymentProviderError('PAYSTACK_UNAVAILABLE', 'synthetic timeout', true);
    return { status: this.initiateMode, reference: input.reference, amountMinor: input.amountMinor, currency: input.currency, transferCode: `TRF_${this.initiations.length}`, transferId: String(this.initiations.length) };
  }
  public async verify(reference: string): Promise<ProviderTransfer> {
    this.verifications.push(reference);
    const original = this.initiations.find((item) => item.reference === reference)!;
    return { status: this.verifyStatus, reference, amountMinor: original.amountMinor, currency: original.currency, transferCode: 'TRF_verified', transferId: '999' };
  }
}

describe('B09 seller earnings and payouts against MariaDB', function () {
  this.timeout(40_000);
  let pool: Pool;
  const provider = new FakeTransferProvider();
  const customerId = '91000000-0000-4000-8000-000000000001';
  const financeId = '91000000-0000-4000-8000-000000000002';
  const sellerUserId = '91000000-0000-4000-8000-000000000003';
  const sellerId = '92000000-0000-4000-8000-000000000001';
  let suborderId: string; let paymentId: string; let successfulPayoutId: string;

  before(async () => {
    process.env.EMAIL_PROVIDER = 'fake';
    const config = loadConfig();
    assert.equal(config.NODE_ENV, 'test'); assert.match(config.DATABASE_NAME, /_test$/);
    await migrate('down'); await migrate('up');
    pool = createDatabasePool(config);
    await seed();
  });
  after(async () => { if (pool) await pool.end(); });

  async function seed(): Promise<void> {
    for (const [id, email] of [[customerId, 'b09.customer@example.test'], [financeId, 'b09.finance@example.test'], [sellerUserId, 'b09.seller@example.test']] as const) await pool.query('INSERT INTO users (id, email, password_hash, display_name, email_verified_at) VALUES (?, ?, ?, ?, NOW(3))', [id, email, 'synthetic', email]);
    await pool.query("INSERT INTO user_roles (user_id, role) VALUES (?, 'customer'), (?, 'finance'), (?, 'seller')", [customerId, financeId, sellerUserId]);
    await pool.query("INSERT INTO sellers (id, user_id, business_name, phone, identity_status, approval_status, approved_at) VALUES (?, ?, 'B09 Seller', '+2348000000901', 'verified', 'approved', NOW(3))", [sellerId, sellerUserId]);
    const categoryId = randomUUID(), productId = randomUUID(), basketId = randomUUID(), quoteId = randomUUID(), orderId = randomUUID(), itemId = randomUUID();
    suborderId = randomUUID(); paymentId = randomUUID();
    await pool.query("INSERT INTO categories (id, name, slug) VALUES (?, 'B09 Fixtures', 'b09-fixtures')", [categoryId]);
    await pool.query("INSERT INTO products (id, seller_id, category_id, name, slug, description, price_minor, publication_status, stock_quantity, published_at) VALUES (?, ?, ?, 'B09 Wig', 'b09-wig', 'fixture', 100000, 'published', 10, NOW(3))", [productId, sellerId, categoryId]);
    await pool.query('INSERT INTO baskets (id, user_id) VALUES (?, ?)', [basketId, customerId]);
    await pool.query("INSERT INTO checkout_quotes (id, basket_id, idempotency_key, request_hash, delivery_method, destination_snapshot, items_subtotal_minor, delivery_total_minor, grand_total_minor, expires_at) VALUES (?, ?, 'b09-quote', ?, 'delivery', ?, 100000, 5000, 105000, DATE_ADD(NOW(3), INTERVAL 1 DAY))", [quoteId, basketId, createHash('sha256').update('b09-quote').digest('hex'), JSON.stringify({ method: 'delivery' })]);
    await pool.query("INSERT INTO orders (id, quote_id, basket_id, user_id, idempotency_key, request_hash, payment_method, status, delivery_method, destination_snapshot, items_subtotal_minor, delivery_total_minor, grand_total_minor, commission_basis, commission_rate_bps, reservation_expires_at) VALUES (?, ?, ?, ?, 'b09-order', ?, 'paystack', 'delivered', 'delivery', ?, 100000, 5000, 105000, 'line_item_gross', 1000, DATE_ADD(NOW(3), INTERVAL 1 DAY))", [orderId, quoteId, basketId, customerId, createHash('sha256').update('b09-order').digest('hex'), JSON.stringify({ method: 'delivery' })]);
    await pool.query("INSERT INTO seller_suborders (id, order_id, seller_id, status, items_subtotal_minor, delivery_fee_minor, commission_minor, seller_net_minor, fulfilled_at) VALUES (?, ?, ?, 'delivered', 100000, 5000, 10000, 90000, NOW(3))", [suborderId, orderId, sellerId]);
    await pool.query("INSERT INTO order_items (id, order_id, suborder_id, product_id, seller_id, product_name, quantity, unit_price_minor, line_total_minor, commission_basis, commission_rate_bps, commission_minor) VALUES (?, ?, ?, ?, ?, 'B09 Wig', 1, 100000, 100000, 'line_item_gross', 1000, 10000)", [itemId, orderId, suborderId, productId, sellerId]);
    await pool.query("INSERT INTO payments (id, order_id, provider_reference, provider_transaction_id, customer_email, expected_amount_minor, currency, status, paid_at, verified_at) VALUES (?, ?, 'LH-B09-1', '99001', 'b09.customer@example.test', 105000, 'NGN', 'succeeded', NOW(3), NOW(3))", [paymentId, orderId]);
  }

  it('keeps fulfilled earnings held and unavailable until the configured hold expires', async () => {
    const heldService = new EarningsPayoutService(pool, provider, { holdDays: 14, payoutsEnabled: true });
    const balance = await heldService.getSellerEarnings(sellerUserId);
    assert.equal(balance.heldMinor, 90000); assert.equal(balance.availableMinor, 0);
    await heldService.configureRecipient(financeId, sellerId, { providerRecipientCode: 'RCP_synthetic09', accountName: 'Synthetic Seller', bankName: 'Synthetic Bank', accountLast4: '0009' });
    await assert.rejects(heldService.createPayout(financeId, sellerId, 1, 'b09-held-payout'), (error: Error & { code?: string }) => error.code === 'INSUFFICIENT_AVAILABLE_EARNINGS');
  });

  it('releases earnings and restores a rejected transfer exactly once', async () => {
    const service = new EarningsPayoutService(pool, provider, { holdDays: 0, payoutsEnabled: true });
    assert.equal((await service.getSellerEarnings(sellerUserId)).availableMinor, 90000);
    provider.initiateMode = 'failed';
    const first = await service.createPayout(financeId, sellerId, 10000, 'b09-failed-payout');
    assert.equal((first.payout as { status: string }).status, 'failed');
    assert.equal((await service.getSellerEarnings(sellerUserId)).availableMinor, 90000);
    const replay = await service.createPayout(financeId, sellerId, 10000, 'b09-failed-payout');
    assert.equal(replay.idempotentReplay, true); assert.equal(provider.initiations.length, 1);
    const [restores] = await pool.query<Array<RowDataPacket & { count: number | string }>>("SELECT COUNT(*) count FROM seller_ledger_entries WHERE logical_key LIKE ?", [`payout:${(first.payout as { id: string }).id}:%restored`]);
    assert.equal(Number(restores[0]!.count), 2);
  });

  it('recovers an uncertain initiation by verifying the original reference and never duplicates it', async () => {
    const service = new EarningsPayoutService(pool, provider, { holdDays: 0, payoutsEnabled: true });
    provider.initiateMode = 'timeout'; provider.verifyStatus = 'success';
    const created = await service.createPayout(financeId, sellerId, 50000, 'b09-timeout-payout');
    assert.equal((created.payout as { status: string }).status, 'initiation_uncertain');
    const reference = (created.payout as { providerReference: string }).providerReference;
    successfulPayoutId = (created.payout as { id: string }).id;
    const reconciled = await service.reconcilePayout(successfulPayoutId) as { status: string };
    assert.equal(reconciled.status, 'success'); assert.deepEqual(provider.verifications, [reference]);
    const balance = await service.getSellerEarnings(sellerUserId);
    assert.equal(balance.availableMinor, 40000); assert.equal(balance.reservedMinor, 0); assert.equal(balance.paidMinor, 50000);
  });

  it('classifies post-payout refunds as available reversal plus recoverable balance without going negative', async () => {
    const [payment] = await pool.query<Array<RowDataPacket & { order_id: string }>>('SELECT order_id FROM payments WHERE id = ?', [paymentId]);
    const reviewId = randomUUID(), refundId = randomUUID(), adjustmentId = randomUUID();
    await pool.query("INSERT INTO payment_review_cases (id, order_id, payment_id, case_type, status, details, resolved_at) VALUES (?, ?, ?, 'late_payment', 'resolved', '{}', NOW(3))", [reviewId, payment[0]!.order_id, paymentId]);
    await pool.query("INSERT INTO refunds (id, payment_review_case_id, payment_id, provider_refund_id, amount_minor, currency, status, initiated_by, processed_at) VALUES (?, ?, ?, 'b09-refund', 60000, 'NGN', 'processed', ?, NOW(3))", [refundId, reviewId, paymentId, financeId]);
    await pool.query('INSERT INTO seller_refund_adjustments (id, refund_id, seller_id, suborder_id, item_gross_reversal_minor, commission_reversal_minor, seller_reversal_minor) VALUES (?, ?, ?, ?, 66667, 6667, 60000)', [adjustmentId, refundId, sellerId, suborderId]);
    const balance = await new EarningsPayoutService(pool, provider, { holdDays: 0, payoutsEnabled: true }).getSellerEarnings(sellerUserId);
    assert.equal(balance.availableMinor, 0); assert.equal(balance.recoverableMinor, 20000); assert.equal(balance.paidMinor, 50000);
    const [adjustment] = await pool.query<Array<RowDataPacket & { classification: string }>>('SELECT classification FROM seller_refund_adjustments WHERE id = ?', [adjustmentId]);
    assert.equal(adjustment[0]!.classification, 'recoverable_balance');
  });

  it('uses a later provider reversal to settle refund recovery before restoring payout eligibility', async () => {
    provider.verifyStatus = 'reversed';
    const service = new EarningsPayoutService(pool, provider, { holdDays: 0, payoutsEnabled: true });
    const payout = await service.reconcilePayout(successfulPayoutId) as { status: string };
    assert.equal(payout.status, 'reversed');
    const balance = await service.getSellerEarnings(sellerUserId);
    assert.equal(balance.paidMinor, 0); assert.equal(balance.recoverableMinor, 0); assert.equal(balance.availableMinor, 30000);
    await service.reconcilePayout(successfulPayoutId);
    assert.equal((await service.getSellerEarnings(sellerUserId)).availableMinor, 30000);
  });
});
