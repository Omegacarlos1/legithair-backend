import assert from 'node:assert/strict';
import request from 'supertest';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import pino from 'pino';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDatabasePool } from '../../src/database/pool.js';
import { migrate } from '../../src/database/migrate.js';
import { AppError } from '../../src/http/errors.js';
import { OrderService } from '../../src/orders/service.js';

interface JobRow extends RowDataPacket { payload: string | { token: string } }
interface CountRow extends RowDataPacket { count: number | string }
interface StockRow extends RowDataPacket { stock_quantity: number }

describe('orders and inventory reservations against MariaDB', function () {
  this.timeout(30_000);
  let pool: Pool;
  let api: ReturnType<typeof request>;
  let customerOneToken: string;
  let customerTwoToken: string;
  let customerOneAddress: string;
  let customerTwoAddress: string;
  let winningToken: string;
  let winningOrderId: string;
  let winningQuoteId: string;
  const password = 'ValidPass123!';
  const zoneId = '50000000-0000-4000-8000-000000000001';
  const sellerId = '21000000-0000-4000-8000-000000000061';
  const productLast = '41000000-0000-4000-8000-000000000061';
  const productRollback = '41000000-0000-4000-8000-000000000062';
  const productGuest = '41000000-0000-4000-8000-000000000063';
  const policy = { reservationTtlSeconds: 1, commissionBasis: 'line_item_gross' as const, commissionRateBps: 1000, codEnabled: true, guestTokenSecret: 'b06-synthetic-guest-token-secret-000001' };

  before(async () => {
    process.env.EMAIL_PROVIDER = 'fake';
    const config = loadConfig();
    assert.equal(config.NODE_ENV, 'test');
    assert.match(config.DATABASE_NAME, /_test$/);
    await migrate('down');
    await migrate('up');
    pool = createDatabasePool(config);
    api = request(createApp({ pool, logger: pino({ level: 'silent' }), readinessTimeoutMs: 100, checkoutQuoteTtlSeconds: 30, orderPolicy: policy }));
    ({ token: customerOneToken } = await registerVerifyAndLogin('order.one@example.test', 'Order One'));
    ({ token: customerTwoToken } = await registerVerifyAndLogin('order.two@example.test', 'Order Two'));
    customerOneAddress = await createAddress(customerOneToken, '11 Synthetic One Street');
    customerTwoAddress = await createAddress(customerTwoToken, '12 Synthetic Two Street');
    await seedProducts();
  });

  after(async () => { if (pool) await pool.end(); });

  async function latestVerificationToken(userId: string): Promise<string> {
    const [rows] = await pool.query<JobRow[]>('SELECT payload FROM durable_jobs WHERE job_type = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload, \'$.userId\')) = ? ORDER BY id DESC LIMIT 1', ['send_verification', userId]);
    const payload = typeof rows[0]!.payload === 'string' ? JSON.parse(rows[0]!.payload) as { token: string } : rows[0]!.payload;
    return payload.token;
  }
  async function registerVerifyAndLogin(email: string, displayName: string): Promise<{ token: string; userId: string }> {
    const registration = await api.post('/api/v1/auth/register').send({ email, password, displayName }).expect(201);
    const userId = registration.body.data.userId as string;
    await api.post('/api/v1/auth/verify-email').send({ token: await latestVerificationToken(userId) }).expect(200);
    const login = await api.post('/api/v1/auth/login').send({ email, password }).expect(200);
    return { token: login.body.data.tokens.accessToken as string, userId };
  }
  async function createAddress(token: string, line1: string): Promise<string> {
    const response = await api.post('/api/v1/me/addresses').set('authorization', `Bearer ${token}`).send({ label: 'Home', recipientName: 'Synthetic Recipient', phone: '+2348000000000', line1, city: 'Ikeja', state: 'Lagos', isDefault: true }).expect(201);
    return response.body.data.id as string;
  }
  async function seedProducts(): Promise<void> {
    const sellerUser = '31000000-0000-4000-8000-000000000061';
    const category = '71000000-0000-4000-8000-000000000061';
    await pool.query("INSERT INTO users (id, email, password_hash, display_name, email_verified_at) VALUES (?, 'b06.seller@example.test', 'synthetic-not-login-capable', 'B06 Seller', NOW(3))", [sellerUser]);
    await pool.query("INSERT INTO user_roles (user_id, role) VALUES (?, 'seller')", [sellerUser]);
    await pool.query("INSERT INTO sellers (id, user_id, business_name, phone, identity_status, approval_status, approved_at) VALUES (?, ?, 'Synthetic B06 Seller', '+2348000000061', 'verified', 'approved', NOW(3))", [sellerId, sellerUser]);
    await pool.query("INSERT INTO categories (id, name, slug) VALUES (?, 'B06 Synthetic Hair', 'b06-synthetic-hair')", [category]);
    await pool.query(`INSERT INTO products (id, seller_id, category_id, name, slug, description, price_minor, publication_status, stock_quantity, published_at) VALUES
      (?, ?, ?, 'B06 Last Wig', 'b06-last-wig', 'Synthetic reservation race fixture.', 100000, 'published', 1, NOW(3)),
      (?, ?, ?, 'B06 Rollback Wig', 'b06-rollback-wig', 'Synthetic rollback and expiry fixture.', 200000, 'published', 1, NOW(3)),
      (?, ?, ?, 'B06 Guest Wig', 'b06-guest-wig', 'Synthetic guest COD fixture.', 300000, 'published', 1, NOW(3))`, [productLast, sellerId, category, productRollback, sellerId, category, productGuest, sellerId, category]);
  }
  async function customerQuote(token: string, addressId: string, productId: string, key: string): Promise<string> {
    await api.post('/api/v1/baskets/items').set('authorization', `Bearer ${token}`).send({ productId, quantity: 1 }).expect(201);
    const quote = await api.post('/api/v1/checkout/quotes').set('authorization', `Bearer ${token}`).set('idempotency-key', key).send({ deliveryMethod: 'delivery', zoneId, addressId }).expect(201);
    return quote.body.data.quote.id as string;
  }

  it('allows only one simultaneous reservation of the final stock item', async () => {
    const quoteOne = await customerQuote(customerOneToken, customerOneAddress, productLast, 'b06-race-quote-one');
    const quoteTwo = await customerQuote(customerTwoToken, customerTwoAddress, productLast, 'b06-race-quote-two');
    const attempts = await Promise.all([
      api.post('/api/v1/orders').set('authorization', `Bearer ${customerOneToken}`).set('idempotency-key', 'b06-race-order-one').send({ quoteId: quoteOne, paymentMethod: 'paystack' }),
      api.post('/api/v1/orders').set('authorization', `Bearer ${customerTwoToken}`).set('idempotency-key', 'b06-race-order-two').send({ quoteId: quoteTwo, paymentMethod: 'paystack' })
    ]);
    assert.deepEqual(attempts.map((result) => result.status).sort(), [201, 409]);
    const winner = attempts.find((result) => result.status === 201)!;
    winningToken = winner === attempts[0] ? customerOneToken : customerTwoToken;
    winningQuoteId = winner === attempts[0] ? quoteOne : quoteTwo;
    winningOrderId = winner.body.data.order.id as string;
    assert.equal(winner.body.data.order.suborders[0].items[0].unitPriceMinor, 100000);
    assert.equal(winner.body.data.order.suborders[0].items[0].commission.amountMinor, 10000);
    const [stock] = await pool.query<StockRow[]>('SELECT stock_quantity FROM products WHERE id = ?', [productLast]);
    assert.equal(stock[0]!.stock_quantity, 0);
  });

  it('replays checkout idempotently and rejects an invalid status transition', async () => {
    const key = winningToken === customerOneToken ? 'b06-race-order-one' : 'b06-race-order-two';
    const replay = await api.post('/api/v1/orders').set('authorization', `Bearer ${winningToken}`).set('idempotency-key', key).send({ quoteId: winningQuoteId, paymentMethod: 'paystack' }).expect(200);
    assert.equal(replay.body.data.order.id, winningOrderId);
    assert.equal(replay.body.data.idempotentReplay, true);
    const orders = new OrderService(pool, policy);
    await assert.rejects(() => orders.transitionOrder(winningOrderId, 'awaiting_collection', 'synthetic_invalid', { type: 'system' }), (error: unknown) => error instanceof AppError && error.code === 'INVALID_ORDER_TRANSITION');
    await orders.transitionOrder(winningOrderId, 'cancelled', 'synthetic_cleanup', { type: 'system' });
  });

  it('rolls back orphan suborders on failure and releases an expired reservation once', async () => {
    const address = winningToken === customerOneToken ? customerOneAddress : customerTwoAddress;
    await api.delete(`/api/v1/baskets/items/${productLast}`).set('authorization', `Bearer ${winningToken}`).expect(204);
    const quoteId = await customerQuote(winningToken, address, productRollback, 'b06-rollback-quote');
    await pool.query("CREATE TRIGGER b06_fail_order_item BEFORE INSERT ON order_items FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic order item failure'");
    await api.post('/api/v1/orders').set('authorization', `Bearer ${winningToken}`).set('idempotency-key', 'b06-rollback-order').send({ quoteId, paymentMethod: 'paystack' }).expect(500);
    await pool.query('DROP TRIGGER b06_fail_order_item');
    const [orphans] = await pool.query<CountRow[]>('SELECT COUNT(*) AS count FROM seller_suborders so LEFT JOIN orders o ON o.id = so.order_id WHERE o.id IS NULL');
    assert.equal(Number(orphans[0]!.count), 0);
    const [failedOrders] = await pool.query<CountRow[]>('SELECT COUNT(*) AS count FROM orders WHERE quote_id = ?', [quoteId]);
    assert.equal(Number(failedOrders[0]!.count), 0);

    const created = await api.post('/api/v1/orders').set('authorization', `Bearer ${winningToken}`).set('idempotency-key', 'b06-expiry-order').send({ quoteId, paymentMethod: 'paystack' }).expect(201);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const orders = new OrderService(pool, policy);
    const counts = await Promise.all([orders.releaseExpiredReservations(), orders.releaseExpiredReservations()]);
    assert.equal(counts.reduce((sum, count) => sum + count, 0), 1);
    const expired = await api.get(`/api/v1/orders/${created.body.data.order.id}`).set('authorization', `Bearer ${winningToken}`).expect(200);
    assert.equal(expired.body.data.order.status, 'reservation_expired');
    const [stock] = await pool.query<StockRow[]>('SELECT stock_quantity FROM products WHERE id = ?', [productRollback]);
    assert.equal(stock[0]!.stock_quantity, 1);
  });

  it('issues a guest tracking credential and creates controlled COD as awaiting collection', async () => {
    const guest = await api.post('/api/v1/baskets/guest').send({}).expect(201);
    const basketToken = guest.body.data.guestBasketToken as string;
    await api.post('/api/v1/baskets/items').set('x-guest-basket-token', basketToken).send({ productId: productGuest, quantity: 1 }).expect(201);
    const quote = await api.post('/api/v1/checkout/quotes').set('x-guest-basket-token', basketToken).set('idempotency-key', 'b06-guest-quote-01').send({ deliveryMethod: 'delivery', zoneId, address: { recipientName: 'Synthetic Guest', phone: '+2348000000000', line1: '13 Synthetic Guest Street', city: 'Ikeja', state: 'Lagos', countryCode: 'NG' } }).expect(201);
    const created = await api.post('/api/v1/orders').set('x-guest-basket-token', basketToken).set('idempotency-key', 'b06-guest-order-01').send({ quoteId: quote.body.data.quote.id, paymentMethod: 'cod' }).expect(201);
    assert.equal(created.body.data.order.status, 'awaiting_collection');
    const trackingToken = created.body.data.guestTrackingToken as string;
    await api.get(`/api/v1/orders/${created.body.data.order.id}`).expect(401);
    await api.get(`/api/v1/orders/${created.body.data.order.id}`).set('x-order-tracking-token', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA').expect(404);
    const tracked = await api.get(`/api/v1/orders/${created.body.data.order.id}`).set('x-order-tracking-token', trackingToken).expect(200);
    assert.equal(tracked.body.data.order.id, created.body.data.order.id);
    const replay = await api.post('/api/v1/orders').set('x-guest-basket-token', basketToken).set('idempotency-key', 'b06-guest-order-01').send({ quoteId: quote.body.data.quote.id, paymentMethod: 'cod' }).expect(200);
    assert.equal(replay.body.data.guestTrackingToken, trackingToken);
  });
});
