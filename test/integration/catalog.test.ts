import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import pino from 'pino';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDatabasePool } from '../../src/database/pool.js';
import { migrate } from '../../src/database/migrate.js';

interface JobRow extends RowDataPacket { payload: string | { token: string } }
interface CountRow extends RowDataPacket { count: number | string }

const VALID_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2b3sAAAAASUVORK5CYII=', 'base64');

describe('catalogue and stock against MariaDB', function () {
  this.timeout(20_000);
  let pool: Pool;
  let api: ReturnType<typeof request>;
  let uploadRoot: string;
  let adminToken: string;
  let ownerToken: string;
  let otherToken: string;
  let pendingToken: string;
  let ownerUserId: string;
  let otherUserId: string;
  let ownerSellerId: string;
  let otherSellerId: string;
  let categoryId: string;
  let productId: string;
  let imageId: string;
  const password = 'ValidPass123!';

  before(async () => {
    process.env.EMAIL_PROVIDER = 'fake';
    const config = loadConfig();
    assert.equal(config.NODE_ENV, 'test');
    assert.match(config.DATABASE_NAME, /_test$/);
    await migrate('down');
    await migrate('up');
    pool = createDatabasePool(config);
    uploadRoot = await mkdtemp(join(tmpdir(), 'legit-b04-images-'));
    api = request(createApp({ pool, logger: pino({ level: 'silent' }), readinessTimeoutMs: 100, imageStorageRoot: uploadRoot, imageMaxBytes: 1024 }));
    ({ token: adminToken } = await registerVerifyAndLogin('catalog.admin@example.test', 'Catalogue Admin', true));
    ({ token: ownerToken, userId: ownerUserId } = await registerVerifyAndLogin('catalog.owner@example.test', 'Catalogue Owner'));
    ({ token: otherToken, userId: otherUserId } = await registerVerifyAndLogin('catalog.other@example.test', 'Other Seller'));
    ({ token: pendingToken } = await registerVerifyAndLogin('catalog.pending@example.test', 'Pending Seller'));
    ownerSellerId = await createSeller(ownerToken, 'Synthetic Approved Catalogue Seller', '+2348000000100');
    otherSellerId = await createSeller(otherToken, 'Synthetic Other Catalogue Seller', '+2348000000101');
    await createSeller(pendingToken, 'Synthetic Pending Catalogue Seller', '+2348000000102');
    await syntheticallyApprove(ownerUserId);
    await syntheticallyApprove(otherUserId);
    const category = await api.post('/api/v1/admin/categories').set('authorization', `Bearer ${adminToken}`).send({ name: 'Human Hair Wigs' }).expect(201);
    categoryId = category.body.data.category.id as string;
  });

  after(async () => {
    if (pool) await pool.end();
    if (uploadRoot) await rm(uploadRoot, { recursive: true, force: true });
  });

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

  async function createSeller(token: string, businessName: string, phone: string): Promise<string> {
    const response = await api.post('/api/v1/sellers').set('authorization', `Bearer ${token}`).send({ businessName, phone }).expect(201);
    return response.body.data.seller.id as string;
  }

  async function syntheticallyApprove(userId: string): Promise<void> {
    await pool.query("UPDATE sellers SET identity_status = 'verified', approval_status = 'approved', approval_reason = 'Synthetic B04 integration fixture', approved_at = NOW(3) WHERE user_id = ?", [userId]);
  }

  async function createProduct(token: string, overrides: Record<string, unknown> = {}): Promise<string> {
    const response = await api.post('/api/v1/seller/products').set('authorization', `Bearer ${token}`).send({
      categoryId,
      name: 'Synthetic Brazilian Wig',
      description: 'Synthetic catalogue fixture with one purchasable configuration.',
      priceMinor: 125000,
      brand: 'Legit Synthetic',
      colour: 'Black',
      size: 'Medium',
      lowStockThreshold: 1,
      initialStock: 1,
      ...overrides
    }).expect(201);
    return response.body.data.product.id as string;
  }

  async function uploadAndPublish(token: string, id: string): Promise<string> {
    const upload = await api.post(`/api/v1/seller/products/${id}/images`).set('authorization', `Bearer ${token}`)
      .field('altText', 'Synthetic one pixel product image').field('sortOrder', '0')
      .attach('image', VALID_PNG, { filename: 'synthetic.png', contentType: 'image/png' }).expect(201);
    await api.patch(`/api/v1/seller/products/${id}/publication`).set('authorization', `Bearer ${token}`).send({ status: 'published' }).expect(200);
    return upload.body.data.image.id as string;
  }

  it('blocks pending sellers and keeps draft products out of the public catalogue', async () => {
    await api.post('/api/v1/seller/products').set('authorization', `Bearer ${pendingToken}`).send({ categoryId, name: 'Blocked Product', description: 'This product must never be created.', priceMinor: 1000 }).expect(403);
    productId = await createProduct(ownerToken);
    const hidden = await api.get('/api/v1/products').query({ q: 'Synthetic Brazilian Wig' }).expect(200);
    assert.equal(hidden.body.data.products.length, 0);
    await api.get(`/api/v1/products/${productId}`).expect(404);
    const missingImage = await api.patch(`/api/v1/seller/products/${productId}/publication`).set('authorization', `Bearer ${ownerToken}`).send({ status: 'published' }).expect(409);
    assert.equal(missingImage.body.error.code, 'PRODUCT_IMAGE_REQUIRED');
  });

  it('validates image declarations, signatures and upload size', async () => {
    await api.post(`/api/v1/seller/products/${productId}/images`).set('authorization', `Bearer ${ownerToken}`)
      .field('altText', 'Invalid text upload').attach('image', Buffer.from('plain text'), { filename: 'bad.txt', contentType: 'text/plain' }).expect(415);
    const invalidSignature = await api.post(`/api/v1/seller/products/${productId}/images`).set('authorization', `Bearer ${ownerToken}`)
      .field('altText', 'Invalid image signature').attach('image', Buffer.from('not a png'), { filename: 'bad.png', contentType: 'image/png' }).expect(415);
    assert.equal(invalidSignature.body.error.code, 'UNSUPPORTED_IMAGE_TYPE');
    await api.post(`/api/v1/seller/products/${productId}/images`).set('authorization', `Bearer ${ownerToken}`)
      .field('altText', 'Oversized synthetic image').attach('image', Buffer.alloc(1025, 1), { filename: 'large.png', contentType: 'image/png' }).expect(413);
  });

  it('uploads a validated image, publishes the product, and serves controlled image bytes', async () => {
    imageId = await uploadAndPublish(ownerToken, productId);
    const product = await api.get(`/api/v1/products/${productId}`).expect(200);
    assert.equal(product.body.data.product.publicationStatus, 'published');
    assert.equal(product.body.data.product.images[0].id, imageId);
    const image = await api.get(`/api/v1/products/${productId}/images/${imageId}`).expect(200).expect('content-type', 'image/png');
    assert.equal(Buffer.compare(image.body as Buffer, VALID_PNG), 0);
  });

  it('enforces product and stock ownership', async () => {
    await api.patch(`/api/v1/seller/products/${productId}`).set('authorization', `Bearer ${otherToken}`).send({ priceMinor: 99999 }).expect(403);
    await api.patch(`/api/v1/seller/products/${productId}/stock`).set('authorization', `Bearer ${otherToken}`).set('idempotency-key', 'other-seller-001').send({ delta: 1, reason: 'Cross seller attempt' }).expect(403);
    const own = await api.get('/api/v1/seller/products').set('authorization', `Bearer ${ownerToken}`).expect(200);
    assert.equal(own.body.data.products.some((product: { id: string }) => product.id === productId), true);
  });

  it('serializes concurrent stock adjustments and safely replays an idempotency key', async () => {
    await api.patch(`/api/v1/seller/products/${productId}/stock`).set('authorization', `Bearer ${ownerToken}`).send({ delta: -1, reason: 'Missing key' }).expect(400);
    const attempts = await Promise.all([
      api.patch(`/api/v1/seller/products/${productId}/stock`).set('authorization', `Bearer ${ownerToken}`).set('idempotency-key', 'stock-race-one').send({ delta: -1, reason: 'Concurrent sale one' }),
      api.patch(`/api/v1/seller/products/${productId}/stock`).set('authorization', `Bearer ${ownerToken}`).set('idempotency-key', 'stock-race-two').send({ delta: -1, reason: 'Concurrent sale two' })
    ]);
    assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 409]);
    const winnerIndex = attempts.findIndex((response) => response.status === 200);
    const winningKey = winnerIndex === 0 ? 'stock-race-one' : 'stock-race-two';
    const replay = await api.patch(`/api/v1/seller/products/${productId}/stock`).set('authorization', `Bearer ${ownerToken}`).set('idempotency-key', winningKey).send({ delta: -1, reason: 'Repeated request' }).expect(200);
    assert.equal(replay.body.data.adjustment.idempotentReplay, true);
    assert.equal(replay.body.data.adjustment.newQuantity, 0);
    const [counts] = await pool.query<CountRow[]>('SELECT COUNT(*) AS count FROM stock_adjustments WHERE product_id = ? AND idempotency_key IN (?, ?)', [productId, 'stock-race-one', 'stock-race-two']);
    assert.equal(Number(counts[0]!.count), 1);
  });

  it('provides stable filters, sorting, pagination and related products', async () => {
    const lowPriceId = await createProduct(ownerToken, { name: 'Synthetic Budget Bob', priceMinor: 50000, brand: 'Budget Brand', colour: 'Brown', size: 'Short', initialStock: 4 });
    const highPriceId = await createProduct(ownerToken, { name: 'Synthetic Premium Curl', priceMinor: 250000, brand: 'Premium Brand', colour: 'Black', size: 'Long', initialStock: 2 });
    await uploadAndPublish(ownerToken, lowPriceId);
    await uploadAndPublish(ownerToken, highPriceId);
    await pool.query('UPDATE products SET paid_units_sold = CASE id WHEN ? THEN 8 WHEN ? THEN 3 ELSE paid_units_sold END WHERE id IN (?, ?)', [highPriceId, lowPriceId, highPriceId, lowPriceId]);

    const filtered = await api.get('/api/v1/products').query({ brand: 'Premium Brand', colour: 'Black', size: 'Long', minPriceMinor: 200000, maxPriceMinor: 300000 }).expect(200);
    assert.deepEqual(filtered.body.data.products.map((product: { id: string }) => product.id), [highPriceId]);
    const searched = await api.get('/api/v1/products').query({ q: 'Premium Curl' }).expect(200);
    assert.deepEqual(searched.body.data.products.map((product: { id: string }) => product.id), [highPriceId]);

    const pageOne = await api.get('/api/v1/products').query({ sort: 'price_asc', page: 1, limit: 1 }).expect(200);
    const pageTwo = await api.get('/api/v1/products').query({ sort: 'price_asc', page: 2, limit: 1 }).expect(200);
    assert.equal(pageOne.body.data.products[0].id, lowPriceId);
    assert.notEqual(pageOne.body.data.products[0].id, pageTwo.body.data.products[0].id);
    assert.equal(pageOne.body.meta.pagination.total, 3);

    const popular = await api.get('/api/v1/products').query({ sort: 'popularity' }).expect(200);
    assert.equal(popular.body.data.products[0].id, highPriceId);
    const related = await api.get(`/api/v1/products/${productId}/related`).expect(200);
    assert.equal(related.body.data.products.some((product: { id: string }) => product.id === productId), false);
    assert.equal(related.body.data.products.length, 2);
  });

  it('lets admins manage products without bypassing publication or seller suspension rules', async () => {
    const changed = await api.patch(`/api/v1/admin/products/${productId}`).set('authorization', `Bearer ${adminToken}`).send({ priceMinor: 130000 }).expect(200);
    assert.equal(changed.body.data.product.priceMinor, 130000);
    await api.patch(`/api/v1/admin/sellers/${otherSellerId}/status`).set('authorization', `Bearer ${adminToken}`).send({ status: 'suspended', reason: 'Synthetic B04 suspension test' }).expect(200);
    await api.post('/api/v1/seller/products').set('authorization', `Bearer ${otherToken}`).send({ categoryId, name: 'Suspended Product', description: 'This must remain blocked after suspension.', priceMinor: 1000 }).expect(403);

    await pool.query("UPDATE sellers SET identity_status = 'not_started', approval_status = 'pending' WHERE id = ?", [ownerSellerId]);
    await api.patch(`/api/v1/admin/products/${productId}/publication`).set('authorization', `Bearer ${adminToken}`).send({ status: 'unpublished' }).expect(200);
    const blocked = await api.patch(`/api/v1/admin/products/${productId}/publication`).set('authorization', `Bearer ${adminToken}`).send({ status: 'published' }).expect(403);
    assert.equal(blocked.body.error.code, 'SELLER_NOT_APPROVED');
    await api.get(`/api/v1/products/${productId}`).expect(404);
  });
});
