import assert from 'node:assert/strict';
import request from 'supertest';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import pino from 'pino';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDatabasePool } from '../../src/database/pool.js';
import { migrate } from '../../src/database/migrate.js';

interface JobRow extends RowDataPacket { payload: string | { token: string } }

describe('baskets and delivery quotes against MariaDB', function () {
  this.timeout(25_000);
  let pool: Pool;
  let api: ReturnType<typeof request>;
  let customerToken: string;
  let otherCustomerToken: string;
  let adminToken: string;
  let customerAddressId: string;
  let otherAddressId: string;
  let guestToken: string;
  const password = 'ValidPass123!';
  const zone1 = '50000000-0000-4000-8000-000000000001';
  const zone2 = '50000000-0000-4000-8000-000000000002';
  const pickupId = '60000000-0000-4000-8000-000000000001';
  const seller1 = '20000000-0000-4000-8000-000000000011';
  const seller2 = '20000000-0000-4000-8000-000000000012';
  const product1 = '40000000-0000-4000-8000-000000000011';
  const product2 = '40000000-0000-4000-8000-000000000012';
  const productOut = '40000000-0000-4000-8000-000000000013';

  before(async () => {
    process.env.EMAIL_PROVIDER = 'fake';
    const config = loadConfig();
    assert.equal(config.NODE_ENV, 'test');
    assert.match(config.DATABASE_NAME, /_test$/);
    await migrate('down');
    await migrate('up');
    pool = createDatabasePool(config);
    api = request(createApp({ pool, logger: pino({ level: 'silent' }), readinessTimeoutMs: 100, checkoutQuoteTtlSeconds: 2 }));
    ({ token: customerToken } = await registerVerifyAndLogin('basket.customer@example.test', 'Basket Customer'));
    ({ token: otherCustomerToken } = await registerVerifyAndLogin('basket.other@example.test', 'Other Customer'));
    ({ token: adminToken } = await registerVerifyAndLogin('basket.admin@example.test', 'Basket Admin', true));
    customerAddressId = await createAddress(customerToken, { city: 'Ikeja', state: 'Lagos' });
    otherAddressId = await createAddress(otherCustomerToken, { city: 'Ikeja', state: 'Lagos' });
    await seedProducts();
    await pool.query("INSERT INTO pickup_locations (id, name, address_line, city, state, fee_minor, min_business_days, max_business_days, is_active, is_synthetic) VALUES (?, 'Synthetic Pickup Hub', '1 Synthetic Dispatch Road', 'Ikeja', 'Lagos', 0, 1, 3, TRUE, TRUE)", [pickupId]);
    await api.put('/api/v1/admin/exchange-rates/usd').set('authorization', `Bearer ${adminToken}`).send({ ngnMinorPerUsdMinor: 1500 }).expect(200);
  });

  after(async () => { if (pool) await pool.end(); });

  async function latestVerificationToken(userId: string): Promise<string> {
    const [rows] = await pool.query<JobRow[]>('SELECT payload FROM durable_jobs WHERE job_type = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload, \'$.userId\')) = ? ORDER BY id DESC LIMIT 1', ['send_verification', userId]);
    const payload = typeof rows[0]!.payload === 'string' ? JSON.parse(rows[0]!.payload) as { token: string } : rows[0]!.payload;
    return payload.token;
  }
  async function registerVerifyAndLogin(email: string, displayName: string, admin = false): Promise<{ token: string; userId: string }> {
    const registration = await api.post('/api/v1/auth/register').send({ email, password, displayName }).expect(201);
    const userId = registration.body.data.userId as string;
    await api.post('/api/v1/auth/verify-email').send({ token: await latestVerificationToken(userId) }).expect(200);
    if (admin) await pool.query("INSERT INTO user_roles (user_id, role) VALUES (?, 'admin')", [userId]);
    const login = await api.post('/api/v1/auth/login').send({ email, password }).expect(200);
    return { token: login.body.data.tokens.accessToken as string, userId };
  }
  async function createAddress(authToken: string, location: { city: string; state: string }): Promise<string> {
    const response = await api.post('/api/v1/me/addresses').set('authorization', `Bearer ${authToken}`).send({ label: 'Home', recipientName: 'Synthetic Recipient', phone: '+2348000000000', line1: '10 Synthetic Street', ...location, isDefault: true }).expect(201);
    return response.body.data.id as string;
  }
  async function seedProducts(): Promise<void> {
    const sellerUsers = ['30000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000012'];
    for (let index = 0; index < sellerUsers.length; index++) {
      await pool.query("INSERT INTO users (id, email, password_hash, display_name, email_verified_at) VALUES (?, ?, 'synthetic-not-login-capable', ?, NOW(3))", [sellerUsers[index], `basket.seller${index + 1}@example.test`, `Basket Seller ${index + 1}`]);
      await pool.query("INSERT INTO user_roles (user_id, role) VALUES (?, 'seller')", [sellerUsers[index]]);
    }
    await pool.query("INSERT INTO sellers (id, user_id, business_name, phone, identity_status, approval_status, approved_at) VALUES (?, ?, 'Synthetic Seller One', '+2348000000011', 'verified', 'approved', NOW(3)), (?, ?, 'Synthetic Seller Two', '+2348000000012', 'verified', 'approved', NOW(3))", [seller1, sellerUsers[0], seller2, sellerUsers[1]]);
    const category = '70000000-0000-4000-8000-000000000001';
    await pool.query("INSERT INTO categories (id, name, slug) VALUES (?, 'B05 Synthetic Hair', 'b05-synthetic-hair')", [category]);
    await pool.query(`INSERT INTO products (id, seller_id, category_id, name, slug, description, price_minor, publication_status, stock_quantity, published_at) VALUES
      (?, ?, ?, 'Synthetic Straight Wig', 'b05-straight-wig', 'Synthetic B05 basket fixture product one.', 100000, 'published', 10, NOW(3)),
      (?, ?, ?, 'Synthetic Curly Wig', 'b05-curly-wig', 'Synthetic B05 basket fixture product two.', 200000, 'published', 10, NOW(3)),
      (?, ?, ?, 'Synthetic Empty Wig', 'b05-empty-wig', 'Synthetic B05 out of stock fixture product.', 300000, 'published', 0, NOW(3))`, [product1, seller1, category, product2, seller2, category, productOut, seller1, category]);
  }
  async function createGuest(): Promise<string> {
    const response = await api.post('/api/v1/baskets/guest').send({}).expect(201);
    return response.body.data.guestBasketToken as string;
  }

  it('isolates guest baskets and treats POST item quantity as an absolute value', async () => {
    guestToken = await createGuest();
    const otherGuest = await createGuest();
    await api.post('/api/v1/baskets/items').set('x-guest-basket-token', guestToken).send({ productId: product1, quantity: 2 }).expect(201);
    const replaced = await api.post('/api/v1/baskets/items').set('x-guest-basket-token', guestToken).send({ productId: product1, quantity: 3 }).expect(201);
    assert.equal(replaced.body.data.basket.items[0].quantity, 3);
    const isolated = await api.get('/api/v1/baskets/current').set('x-guest-basket-token', otherGuest).expect(200);
    assert.equal(isolated.body.data.basket.items.length, 0);
    await api.post('/api/v1/baskets/items').set('x-guest-basket-token', guestToken).send({ productId: productOut, quantity: 1 }).expect(409);
  });

  it('lets admins manage zones and pickup locations while rejecting non-Lagos addresses', async () => {
    const zone = await api.post('/api/v1/admin/delivery-zones').set('authorization', `Bearer ${adminToken}`).send({ code: 'synthetic-b05-extra', name: 'Synthetic Extra Zone', coverage: ['Synthetic Area'], feeMinor: 900000, minBusinessDays: 2, maxBusinessDays: 4, isActive: true }).expect(201);
    await api.patch(`/api/v1/admin/delivery-zones/${zone.body.data.zone.id}`).set('authorization', `Bearer ${adminToken}`).send({ isActive: false }).expect(200);
    const pickup = await api.post('/api/v1/admin/pickup-locations').set('authorization', `Bearer ${adminToken}`).send({ name: 'Synthetic Real-Shape Pickup', addressLine: '12 Synthetic Admin Road', city: 'Ikeja', state: 'Lagos', feeMinor: 50000, minBusinessDays: 1, maxBusinessDays: 2, isActive: false }).expect(201);
    await api.patch(`/api/v1/admin/pickup-locations/${pickup.body.data.pickupLocation.id}`).set('authorization', `Bearer ${adminToken}`).send({ isActive: true }).expect(200);
    await api.post('/api/v1/admin/pickup-locations').set('authorization', `Bearer ${adminToken}`).send({ name: 'Outside Pickup', addressLine: '12 Outside Road', city: 'Ibadan', state: 'Oyo', minBusinessDays: 1, maxBusinessDays: 2 }).expect(400);

    const unsupportedGuest = await createGuest();
    await api.post('/api/v1/baskets/items').set('x-guest-basket-token', unsupportedGuest).send({ productId: product1, quantity: 1 }).expect(201);
    const unsupported = await api.post('/api/v1/checkout/quotes').set('x-guest-basket-token', unsupportedGuest).set('idempotency-key', 'b05-unsupported-01').send({ deliveryMethod: 'delivery', zoneId: zone1, address: { recipientName: 'Synthetic Guest', phone: '+2348000000000', line1: '1 Outside Street', city: 'Ibadan', state: 'Oyo', countryCode: 'NG' } }).expect(409);
    assert.equal(unsupported.body.error.code, 'DELIVERY_ADDRESS_UNSUPPORTED');
  });

  it('merges once under concurrent replay without duplicating lines or bypassing limits', async () => {
    await api.post('/api/v1/baskets/items').set('authorization', `Bearer ${customerToken}`).send({ productId: product1, quantity: 2 }).expect(201);
    await api.post('/api/v1/baskets/items').set('x-guest-basket-token', guestToken).send({ productId: product2, quantity: 1 }).expect(201);
    const attempts = await Promise.all([
      api.post('/api/v1/baskets/merge').set('authorization', `Bearer ${customerToken}`).set('x-guest-basket-token', guestToken).send({}),
      api.post('/api/v1/baskets/merge').set('authorization', `Bearer ${customerToken}`).set('x-guest-basket-token', guestToken).send({})
    ]);
    assert.deepEqual(attempts.map((response) => response.status), [200, 200]);
    const basket = await api.get('/api/v1/baskets/current').set('authorization', `Bearer ${customerToken}`).expect(200);
    const quantities = new Map<string, number>(basket.body.data.basket.items.map((item: { productId: string; quantity: number }) => [item.productId, item.quantity]));
    assert.equal(quantities.get(product1), 5);
    assert.equal(quantities.get(product2), 1);
    const other = await api.get('/api/v1/baskets/current').set('authorization', `Bearer ${otherCustomerToken}`).expect(200);
    assert.equal(other.body.data.basket.items.length, 0);

    const excessive = await createGuest();
    await pool.query('UPDATE products SET stock_quantity = 30 WHERE id = ?', [product1]);
    await api.post('/api/v1/baskets/items').set('x-guest-basket-token', excessive).send({ productId: product1, quantity: 20 }).expect(201);
    const rejected = await api.post('/api/v1/baskets/merge').set('authorization', `Bearer ${customerToken}`).set('x-guest-basket-token', excessive).send({}).expect(409);
    assert.equal(rejected.body.error.code, 'BASKET_QUANTITY_LIMIT');
    await pool.query('UPDATE products SET stock_quantity = 10 WHERE id = ?', [product1]);
  });

  it('quotes deterministic per-seller delivery, USD display, ownership, and idempotent replay', async () => {
    const body = { deliveryMethod: 'delivery', zoneId: zone1, addressId: customerAddressId };
    await api.post('/api/v1/checkout/quotes').set('authorization', `Bearer ${customerToken}`).send(body).expect(400);
    const created = await api.post('/api/v1/checkout/quotes').set('authorization', `Bearer ${customerToken}`).set('idempotency-key', 'b05-quote-main-001').send(body).expect(201);
    const quote = created.body.data.quote;
    assert.equal(quote.totals.itemsSubtotalMinor, 700000);
    assert.equal(quote.totals.deliveryTotalMinor, 900000);
    assert.equal(quote.totals.grandTotalMinor, 1600000);
    assert.equal(quote.deliveryAllocations.length, 2);
    assert.equal(quote.usdIndicative.grandTotalMinor, 1067);
    assert.equal(quote.usdIndicative.settlementCurrency, 'NGN');
    const replay = await api.post('/api/v1/checkout/quotes').set('authorization', `Bearer ${customerToken}`).set('idempotency-key', 'b05-quote-main-001').send(body).expect(200);
    assert.equal(replay.body.data.quote.id, quote.id);
    assert.equal(replay.body.data.idempotentReplay, true);
    await api.post('/api/v1/checkout/quotes').set('authorization', `Bearer ${customerToken}`).set('idempotency-key', 'b05-quote-main-001').send({ deliveryMethod: 'pickup', pickupLocationId: pickupId }).expect(409);
    await api.get(`/api/v1/checkout/quotes/${quote.id}`).set('authorization', `Bearer ${otherCustomerToken}`).expect(404);
    await api.post('/api/v1/checkout/quotes').set('authorization', `Bearer ${customerToken}`).set('idempotency-key', 'b05-zone-mismatch-001').send({ deliveryMethod: 'delivery', zoneId: zone2, addressId: customerAddressId }).expect(409);
    await api.post('/api/v1/checkout/quotes').set('authorization', `Bearer ${customerToken}`).set('idempotency-key', 'b05-cross-address-01').send({ deliveryMethod: 'delivery', zoneId: zone1, addressId: otherAddressId }).expect(404);
  });

  it('rejects stale prices and unavailable stock until explicitly refreshed or restored', async () => {
    await pool.query('UPDATE products SET price_minor = 110000 WHERE id = ?', [product1]);
    const stale = await api.post('/api/v1/checkout/quotes').set('authorization', `Bearer ${customerToken}`).set('idempotency-key', 'b05-stale-price-01').send({ deliveryMethod: 'delivery', zoneId: zone1, addressId: customerAddressId }).expect(409);
    assert.equal(stale.body.error.code, 'STALE_BASKET_PRICE');
    await api.post('/api/v1/baskets/refresh').set('authorization', `Bearer ${customerToken}`).send({}).expect(200);
    await pool.query('UPDATE products SET stock_quantity = 0 WHERE id = ?', [product2]);
    const unavailable = await api.post('/api/v1/checkout/quotes').set('authorization', `Bearer ${customerToken}`).set('idempotency-key', 'b05-no-stock-0001').send({ deliveryMethod: 'delivery', zoneId: zone1, addressId: customerAddressId }).expect(409);
    assert.equal(unavailable.body.error.code, 'BASKET_ITEM_UNAVAILABLE');
    await pool.query('UPDATE products SET stock_quantity = 10 WHERE id = ?', [product2]);
  });

  it('creates a zero-fee pickup quote and rejects it after expiry', async () => {
    const created = await api.post('/api/v1/checkout/quotes').set('authorization', `Bearer ${customerToken}`).set('idempotency-key', 'b05-pickup-expire').send({ deliveryMethod: 'pickup', pickupLocationId: pickupId }).expect(201);
    assert.equal(created.body.data.quote.totals.deliveryTotalMinor, 0);
    await new Promise((resolve) => setTimeout(resolve, 2100));
    const expired = await api.get(`/api/v1/checkout/quotes/${created.body.data.quote.id}`).set('authorization', `Bearer ${customerToken}`).expect(410);
    assert.equal(expired.body.error.code, 'QUOTE_EXPIRED');
  });
});
