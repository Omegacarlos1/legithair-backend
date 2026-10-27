import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import pino from 'pino';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDatabasePool } from '../../src/database/pool.js';
import { migrate } from '../../src/database/migrate.js';
import { PaymentProviderError, type InitializePaymentInput, type InitializedPayment, type PaymentProvider, type VerifiedPayment } from '../../src/payments/provider.js';
import { OrderService } from '../../src/orders/service.js';

interface JobRow extends RowDataPacket { payload: string | { token: string } }
interface CountRow extends RowDataPacket { total: number | string }
interface ArtifactCountRow extends CountRow { ledger: number | string; receipts: number | string; jobs: number | string }
interface StatusRow extends RowDataPacket { status: string; stock_quantity?: number }
interface PopularityRow extends RowDataPacket { paid_units_sold: number }

class FakePaystackProvider implements PaymentProvider {
  public readonly initializations = new Map<string, InitializePaymentInput>();
  public readonly results = new Map<string, VerifiedPayment>();
  public verifyCalls = 0;
  public failNextInitialize = false;
  private transaction = 1000;

  public async initialize(input: InitializePaymentInput): Promise<InitializedPayment> {
    this.initializations.set(input.reference, structuredClone(input));
    if (this.failNextInitialize) {
      this.failNextInitialize = false;
      throw new PaymentProviderError('PAYSTACK_UNAVAILABLE', 'synthetic timeout', true);
    }
    this.results.set(input.reference, { status: 'pending', reference: input.reference, amountMinor: input.amountMinor, currency: input.currency, providerTransactionId: String(++this.transaction), paidAt: null, metadata: input.metadata });
    return { authorizationUrl: `https://checkout.paystack.test/${input.reference}`, accessCode: `access-${input.reference}`, reference: input.reference };
  }

  public async verify(reference: string): Promise<VerifiedPayment> {
    this.verifyCalls++;
    const result = this.results.get(reference);
    if (!result) throw new PaymentProviderError('PAYSTACK_REQUEST_FAILED', 'not found', false);
    return structuredClone(result);
  }

  public succeed(reference: string, changes: Partial<VerifiedPayment> = {}): VerifiedPayment {
    const current = this.results.get(reference)!;
    const result = { ...current, status: 'success', paidAt: new Date('2026-10-26T12:00:00.000Z'), ...changes };
    this.results.set(reference, result);
    return result;
  }
}

describe('Paystack payments, reconciliation, and paid receipts against MariaDB', function () {
  this.timeout(40_000);
  let pool: Pool;
  let api: ReturnType<typeof request>;
  const provider = new FakePaystackProvider();
  const password = 'ValidPass123!';
  const webhookSecret = 'sk_test_b07_synthetic_webhook_secret';
  const zoneId = '50000000-0000-4000-8000-000000000001';
  const sellerId = '22000000-0000-4000-8000-000000000071';
  const productIds = Array.from({ length: 7 }, (_, index) => `42000000-0000-4000-8000-00000000007${index + 1}`);
  const policy = { reservationTtlSeconds: 60, commissionBasis: 'line_item_gross' as const, commissionRateBps: 1000, codEnabled: false, guestTokenSecret: 'b07-synthetic-guest-token-secret-000001' };

  before(async () => {
    process.env.EMAIL_PROVIDER = 'fake';
    const config = loadConfig();
    assert.equal(config.NODE_ENV, 'test');
    assert.match(config.DATABASE_NAME, /_test$/);
    await migrate('down');
    await migrate('up');
    pool = createDatabasePool(config);
    api = request(createApp({ pool, logger: pino({ level: 'silent' }), readinessTimeoutMs: 100, checkoutQuoteTtlSeconds: 60, orderPolicy: policy, paymentProvider: provider, paystackWebhookSecret: webhookSecret }));
    await seedProducts();
  });

  after(async () => { if (pool) await pool.end(); });

  async function latestVerificationToken(userId: string): Promise<string> {
    const [rows] = await pool.query<JobRow[]>('SELECT payload FROM durable_jobs WHERE job_type = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload, \'$.userId\')) = ? ORDER BY id DESC LIMIT 1', ['send_verification', userId]);
    const payload = typeof rows[0]!.payload === 'string' ? JSON.parse(rows[0]!.payload) as { token: string } : rows[0]!.payload;
    return payload.token;
  }

  async function createPaystackOrder(sequence: number, productId: string): Promise<{ token: string; orderId: string; amountMinor: number }> {
    const email = `b07.customer.${sequence}@example.test`;
    const registration = await api.post('/api/v1/auth/register').send({ email, password, displayName: `B07 Customer ${sequence}` }).expect(201);
    const userId = registration.body.data.userId as string;
    await api.post('/api/v1/auth/verify-email').send({ token: await latestVerificationToken(userId) }).expect(200);
    const login = await api.post('/api/v1/auth/login').send({ email, password }).expect(200);
    const token = login.body.data.tokens.accessToken as string;
    const address = await api.post('/api/v1/me/addresses').set('authorization', `Bearer ${token}`).send({ label: 'Home', recipientName: 'Synthetic Recipient', phone: '+2348000000000', line1: `${sequence} B07 Synthetic Street`, city: 'Ikeja', state: 'Lagos', isDefault: true }).expect(201);
    await api.post('/api/v1/baskets/items').set('authorization', `Bearer ${token}`).send({ productId, quantity: 1 }).expect(201);
    const quote = await api.post('/api/v1/checkout/quotes').set('authorization', `Bearer ${token}`).set('idempotency-key', `b07-quote-${sequence}-0001`).send({ deliveryMethod: 'delivery', zoneId, addressId: address.body.data.id }).expect(201);
    const order = await api.post('/api/v1/orders').set('authorization', `Bearer ${token}`).set('idempotency-key', `b07-order-${sequence}-0001`).send({ quoteId: quote.body.data.quote.id, paymentMethod: 'paystack' }).expect(201);
    return { token, orderId: order.body.data.order.id as string, amountMinor: order.body.data.order.totals.grandTotalMinor as number };
  }

  async function initialize(order: { token: string; orderId: string }): Promise<{ id: string; reference: string }> {
    const response = await api.post('/api/v1/payments/initialize').set('authorization', `Bearer ${order.token}`).send({ orderId: order.orderId }).expect(201);
    return { id: response.body.data.payment.id as string, reference: response.body.data.payment.reference as string };
  }

  async function seedProducts(): Promise<void> {
    const sellerUser = '32000000-0000-4000-8000-000000000071';
    const category = '72000000-0000-4000-8000-000000000071';
    await pool.query("INSERT INTO users (id, email, password_hash, display_name, email_verified_at) VALUES (?, 'b07.seller@example.test', 'synthetic-not-login-capable', 'B07 Seller', NOW(3))", [sellerUser]);
    await pool.query("INSERT INTO user_roles (user_id, role) VALUES (?, 'seller')", [sellerUser]);
    await pool.query("INSERT INTO sellers (id, user_id, business_name, phone, identity_status, approval_status, approved_at) VALUES (?, ?, 'Synthetic B07 Seller', '+2348000000071', 'verified', 'approved', NOW(3))", [sellerId, sellerUser]);
    await pool.query("INSERT INTO categories (id, name, slug) VALUES (?, 'B07 Synthetic Hair', 'b07-synthetic-hair')", [category]);
    for (let index = 0; index < productIds.length; index++) {
      await pool.query("INSERT INTO products (id, seller_id, category_id, name, slug, description, price_minor, publication_status, stock_quantity, published_at) VALUES (?, ?, ?, ?, ?, 'Synthetic B07 payment fixture.', 100000, 'published', 1, NOW(3))", [productIds[index]!, sellerId, category, `B07 Payment Wig ${index + 1}`, `b07-payment-wig-${index + 1}`]);
    }
  }

  function signedWebhook(result: VerifiedPayment): { raw: string; signature: string } {
    const raw = JSON.stringify({ event: 'charge.success', data: { id: result.providerTransactionId, status: result.status, reference: result.reference, amount: result.amountMinor, currency: result.currency, paid_at: result.paidAt?.toISOString(), metadata: result.metadata } });
    return { raw, signature: createHmac('sha512', webhookSecret).update(raw).digest('hex') };
  }

  it('verifies exact amount, currency, reference, and association before one atomic paid receipt', async () => {
    const order = await createPaystackOrder(1, productIds[0]!);
    const payment = await initialize(order);
    const initialized = provider.initializations.get(payment.reference)!;
    assert.equal(initialized.amountMinor, order.amountMinor);
    assert.equal(initialized.currency, 'NGN');
    provider.succeed(payment.reference);
    const verified = await api.post('/api/v1/payments/verify').set('authorization', `Bearer ${order.token}`).send({ orderId: order.orderId, reference: payment.reference }).expect(200);
    assert.equal(verified.body.data.outcome, 'succeeded');
    const replay = await api.post('/api/v1/payments/verify').set('authorization', `Bearer ${order.token}`).send({ orderId: order.orderId, reference: payment.reference }).expect(200);
    assert.equal(replay.body.data.outcome, 'already_succeeded');
    const receipt = await api.get(`/api/v1/orders/${order.orderId}/receipt`).set('authorization', `Bearer ${order.token}`).expect(200);
    assert.match(String(receipt.headers['content-disposition']), /attachment/);
    assert.equal(receipt.body.data.receipt.amountMinor, order.amountMinor);
    const [counts] = await pool.query<ArtifactCountRow[]>(`SELECT
      (SELECT COUNT(*) FROM payment_ledger_entries WHERE payment_id = ?) +
      (SELECT COUNT(*) FROM paid_receipts WHERE payment_id = ?) +
      (SELECT COUNT(*) FROM durable_jobs WHERE deduplication_key = ?) AS total`, [payment.id, payment.id, `paid-receipt:${payment.id}`]);
    assert.equal(Number(counts[0]!.total), 3);
    const [statuses] = await pool.query<StatusRow[]>("SELECT status FROM orders WHERE id = ? UNION ALL SELECT status FROM inventory_reservations WHERE order_id = ?", [order.orderId, order.orderId]);
    assert.deepEqual(statuses.map((row) => row.status), ['paid', 'consumed']);
    const [popularity] = await pool.query<PopularityRow[]>('SELECT paid_units_sold FROM products WHERE id = ?', [productIds[0]]);
    assert.equal(popularity[0]!.paid_units_sold, 1);
  });

  it('rejects callback reference tampering and records a provider amount mismatch without delivering value', async () => {
    const order = await createPaystackOrder(2, productIds[1]!);
    const payment = await initialize(order);
    const callsBefore = provider.verifyCalls;
    await api.post('/api/v1/payments/verify').set('authorization', `Bearer ${order.token}`).send({ orderId: order.orderId, reference: 'LH-tampered-reference' }).expect(409);
    assert.equal(provider.verifyCalls, callsBefore);
    provider.succeed(payment.reference, { amountMinor: order.amountMinor + 1 });
    const mismatch = await api.post('/api/v1/payments/verify').set('authorization', `Bearer ${order.token}`).send({ orderId: order.orderId, reference: payment.reference }).expect(409);
    assert.equal(mismatch.body.error.code, 'PAYMENT_VERIFICATION_MISMATCH');
    const [rows] = await pool.query<StatusRow[]>("SELECT status FROM orders WHERE id = ? UNION ALL SELECT status FROM payments WHERE id = ? UNION ALL SELECT case_type AS status FROM payment_review_cases WHERE payment_id = ?", [order.orderId, payment.id, payment.id]);
    assert.deepEqual(rows.map((row) => row.status), ['awaiting_payment', 'mismatch', 'amount_mismatch']);
  });

  it('requires a guest payment email and preserves tracking-token ownership through receipt download', async () => {
    const guest = await api.post('/api/v1/baskets/guest').send({}).expect(201);
    const basketToken = guest.body.data.guestBasketToken as string;
    await api.post('/api/v1/baskets/items').set('x-guest-basket-token', basketToken).send({ productId: productIds[6], quantity: 1 }).expect(201);
    const quote = await api.post('/api/v1/checkout/quotes').set('x-guest-basket-token', basketToken).set('idempotency-key', 'b07-guest-quote-0001').send({ deliveryMethod: 'delivery', zoneId, address: { recipientName: 'B07 Guest', phone: '+2348000000000', line1: '7 B07 Guest Street', city: 'Ikeja', state: 'Lagos', countryCode: 'NG' } }).expect(201);
    const order = await api.post('/api/v1/orders').set('x-guest-basket-token', basketToken).set('idempotency-key', 'b07-guest-order-0001').send({ quoteId: quote.body.data.quote.id, paymentMethod: 'paystack' }).expect(201);
    const orderId = order.body.data.order.id as string;
    const trackingToken = order.body.data.guestTrackingToken as string;
    await api.post('/api/v1/payments/initialize').set('x-order-tracking-token', trackingToken).send({ orderId }).expect(400);
    const initialized = await api.post('/api/v1/payments/initialize').set('x-order-tracking-token', trackingToken).send({ orderId, email: 'b07.guest@example.test' }).expect(201);
    const reference = initialized.body.data.payment.reference as string;
    provider.succeed(reference);
    await api.post('/api/v1/payments/verify').set('x-order-tracking-token', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA').send({ orderId, reference }).expect(404);
    await api.post('/api/v1/payments/verify').set('x-order-tracking-token', trackingToken).send({ orderId, reference }).expect(200);
    await api.get(`/api/v1/orders/${orderId}/receipt`).set('x-order-tracking-token', trackingToken).expect(200);
  });

  it('persists one attempt across a provider timeout and retries the same reference', async () => {
    const order = await createPaystackOrder(3, productIds[2]!);
    provider.failNextInitialize = true;
    const unavailable = await api.post('/api/v1/payments/initialize').set('authorization', `Bearer ${order.token}`).send({ orderId: order.orderId }).expect(503);
    assert.equal(unavailable.body.error.code, 'PAYMENT_PROVIDER_UNAVAILABLE');
    const retry = await api.post('/api/v1/payments/initialize').set('authorization', `Bearer ${order.token}`).send({ orderId: order.orderId }).expect(200);
    const [counts] = await pool.query<CountRow[]>('SELECT COUNT(*) AS total FROM payments WHERE order_id = ?', [order.orderId]);
    assert.equal(Number(counts[0]!.total), 1);
    assert.match(retry.body.data.payment.authorizationUrl, /checkout\.paystack\.test/);
  });

  it('deduplicates signed webhook deliveries without duplicate receipts, ledger entries, or email jobs', async () => {
    const order = await createPaystackOrder(4, productIds[3]!);
    const payment = await initialize(order);
    const webhook = signedWebhook(provider.succeed(payment.reference));
    const first = await api.post('/api/v1/payments/webhooks/paystack').set('content-type', 'application/json').set('x-paystack-signature', webhook.signature).send(webhook.raw).expect(200);
    const duplicate = await api.post('/api/v1/payments/webhooks/paystack').set('content-type', 'application/json').set('x-paystack-signature', webhook.signature).send(webhook.raw).expect(200);
    assert.equal(first.body.data.duplicate, false);
    assert.equal(duplicate.body.data.duplicate, true);
    const [counts] = await pool.query<CountRow[]>(`SELECT
      (SELECT COUNT(*) FROM payment_webhook_events WHERE payment_id = ?) AS total,
      (SELECT COUNT(*) FROM payment_ledger_entries WHERE payment_id = ?) AS ledger,
      (SELECT COUNT(*) FROM paid_receipts WHERE payment_id = ?) AS receipts,
      (SELECT COUNT(*) FROM durable_jobs WHERE deduplication_key = ?) AS jobs`, [payment.id, payment.id, payment.id, `paid-receipt:${payment.id}`]);
    assert.equal(Number(counts[0]!.total), 1);
    assert.equal(Number(counts[0]!.ledger), 1);
    assert.equal(Number(counts[0]!.receipts), 1);
    assert.equal(Number(counts[0]!.jobs), 1);
  });

  it('rolls back a crash and safely reprocesses the same webhook', async () => {
    const order = await createPaystackOrder(5, productIds[4]!);
    const payment = await initialize(order);
    const webhook = signedWebhook(provider.succeed(payment.reference));
    await pool.query("CREATE TRIGGER b07_fail_ledger BEFORE INSERT ON payment_ledger_entries FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic ledger crash'");
    await api.post('/api/v1/payments/webhooks/paystack').set('content-type', 'application/json').set('x-paystack-signature', webhook.signature).send(webhook.raw).expect(500);
    await pool.query('DROP TRIGGER b07_fail_ledger');
    const [before] = await pool.query<CountRow[]>(`SELECT (SELECT COUNT(*) FROM payment_webhook_events WHERE payment_id = ?) + (SELECT COUNT(*) FROM paid_receipts WHERE payment_id = ?) AS total`, [payment.id, payment.id]);
    assert.equal(Number(before[0]!.total), 0);
    await api.post('/api/v1/payments/webhooks/paystack').set('content-type', 'application/json').set('x-paystack-signature', webhook.signature).send(webhook.raw).expect(200);
    const [after] = await pool.query<StatusRow[]>('SELECT status FROM orders WHERE id = ?', [order.orderId]);
    assert.equal(after[0]!.status, 'paid');
  });

  it('flags a late payment for controlled resolution without consuming another order reservation', async () => {
    const lateOrder = await createPaystackOrder(6, productIds[5]!);
    const payment = await initialize(lateOrder);
    await pool.query('UPDATE orders SET reservation_expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?', [lateOrder.orderId]);
    await pool.query('UPDATE inventory_reservations SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE order_id = ?', [lateOrder.orderId]);
    const released = await new OrderService(pool, policy).releaseExpiredReservations();
    assert.equal(released, 1);
    const currentOrder = await createPaystackOrder(7, productIds[5]!);
    const webhook = signedWebhook(provider.succeed(payment.reference));
    const result = await api.post('/api/v1/payments/webhooks/paystack').set('content-type', 'application/json').set('x-paystack-signature', webhook.signature).send(webhook.raw).expect(200);
    assert.equal(result.body.data.outcome, 'late_payment');
    const [rows] = await pool.query<Array<RowDataPacket & { late_status: string; current_reservation: string; stock_quantity: number; receipts: number | string; reviews: number | string }>>(`SELECT
      (SELECT status FROM payments WHERE id = ?) AS late_status,
      (SELECT status FROM inventory_reservations WHERE order_id = ?) AS current_reservation,
      (SELECT stock_quantity FROM products WHERE id = ?) AS stock_quantity,
      (SELECT COUNT(*) FROM paid_receipts WHERE payment_id = ?) AS receipts,
      (SELECT COUNT(*) FROM payment_review_cases WHERE payment_id = ? AND case_type = 'late_payment') AS reviews`, [payment.id, currentOrder.orderId, productIds[5], payment.id, payment.id]);
    assert.equal(rows[0]!.late_status, 'late_success');
    assert.equal(rows[0]!.current_reservation, 'active');
    assert.equal(rows[0]!.stock_quantity, 0);
    assert.equal(Number(rows[0]!.receipts), 0);
    assert.equal(Number(rows[0]!.reviews), 1);
  });
});
