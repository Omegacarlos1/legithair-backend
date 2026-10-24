import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { AppError } from '../http/errors.js';
import { LocalImageStorage } from './image-storage.js';
import type { ProductImage, ProductInput, ProductListQuery, ProductUpdateInput, ProductView, PublicationStatus } from './types.js';

type Queryable = Pool | PoolConnection;

interface CategoryRow extends RowDataPacket { id: string; name: string; slug: string; is_active: number; created_at: Date; updated_at: Date }
interface SellerAccessRow extends RowDataPacket { id: string; user_id: string; identity_status: string; approval_status: string }
interface ProductRow extends RowDataPacket {
  id: string; seller_id: string; category_id: string; name: string; slug: string; description: string; price_minor: number | string;
  brand: string | null; colour: string | null; size_label: string | null; publication_status: PublicationStatus;
  stock_quantity: number; low_stock_threshold: number; paid_units_sold: number | string; published_at: Date | null;
  created_at: Date; updated_at: Date; category_name: string; category_slug: string; seller_name: string;
  primary_image_id: string | null; primary_image_mime: string | null; primary_image_size: number | null;
  primary_image_alt: string | null; primary_image_order: number | null;
}
interface ImageRow extends RowDataPacket { id: string; product_id: string; storage_key: string; mime_type: string; size_bytes: number; alt_text: string; sort_order: number }
interface CountRow extends RowDataPacket { count: number | string }
interface AdjustmentRow extends RowDataPacket { id: number | string; previous_quantity: number; new_quantity: number; delta: number }

const PRODUCT_SELECT = `SELECT p.*, c.name AS category_name, c.slug AS category_slug, s.business_name AS seller_name,
  (SELECT pi.id FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order, pi.id LIMIT 1) AS primary_image_id,
  (SELECT pi.mime_type FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order, pi.id LIMIT 1) AS primary_image_mime,
  (SELECT pi.size_bytes FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order, pi.id LIMIT 1) AS primary_image_size,
  (SELECT pi.alt_text FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order, pi.id LIMIT 1) AS primary_image_alt,
  (SELECT pi.sort_order FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order, pi.id LIMIT 1) AS primary_image_order
  FROM products p JOIN categories c ON c.id = p.category_id JOIN sellers s ON s.id = p.seller_id`;

export class CatalogService {
  public constructor(private readonly pool: Pool, private readonly imageStorage: LocalImageStorage) {}

  public async listCategories(): Promise<object[]> {
    const [rows] = await this.pool.query<CategoryRow[]>('SELECT * FROM categories WHERE is_active = TRUE ORDER BY name, id');
    return rows.map((row) => this.categoryView(row));
  }

  public async createCategory(actorUserId: string, nameInput: string): Promise<object> {
    const id = randomUUID();
    const name = nameInput.trim();
    const slug = slugify(name);
    try {
      await this.pool.query('INSERT INTO categories (id, name, slug, created_by) VALUES (?, ?, ?, ?)', [id, name, slug, actorUserId]);
    } catch (error) {
      if (isDuplicate(error)) throw new AppError(409, 'CATEGORY_ALREADY_EXISTS', 'A category with this name already exists');
      throw error;
    }
    return this.getCategory(id, false);
  }

  public async updateCategory(categoryId: string, input: { name?: string; isActive?: boolean }): Promise<object> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (input.name !== undefined) {
      const name = input.name.trim();
      sets.push('name = ?', 'slug = ?');
      values.push(name, slugify(name));
    }
    if (input.isActive !== undefined) { sets.push('is_active = ?'); values.push(input.isActive); }
    try {
      const [result] = await this.pool.query<import('mysql2/promise').ResultSetHeader>(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`, [...values, categoryId]);
      if (result.affectedRows === 0) throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
    } catch (error) {
      if (isDuplicate(error)) throw new AppError(409, 'CATEGORY_ALREADY_EXISTS', 'A category with this name already exists');
      throw error;
    }
    return this.getCategory(categoryId, false);
  }

  public async createProduct(actorUserId: string, input: ProductInput): Promise<ProductView> {
    await this.requireActiveCategory(this.pool, input.categoryId);
    const id = randomUUID();
    const slug = `${slugify(input.name)}-${id.slice(0, 8)}`;
    const initialStock = input.initialStock ?? 0;
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const seller = await this.requireApprovedSeller(connection, actorUserId, true);
      await connection.query(
        `INSERT INTO products (id, seller_id, category_id, name, slug, description, price_minor, brand, colour, size_label, stock_quantity, low_stock_threshold)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, seller.id, input.categoryId, input.name.trim(), slug, input.description.trim(), input.priceMinor, cleanOptional(input.brand), cleanOptional(input.colour), cleanOptional(input.size), initialStock, input.lowStockThreshold ?? 0]
      );
      if (initialStock > 0) {
        await connection.query(
          'INSERT INTO stock_adjustments (product_id, actor_user_id, idempotency_key, delta, previous_quantity, new_quantity, reason) VALUES (?, ?, ?, ?, 0, ?, ?)',
          [id, actorUserId, `initial:${id}`, initialStock, initialStock, 'Initial product stock']
        );
      }
      await this.audit(connection, id, actorUserId, 'product_created', { initialStock });
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return this.getProductForActor(id);
  }

  public async listOwnProducts(actorUserId: string): Promise<ProductView[]> {
    const seller = await this.requireApprovedSeller(this.pool, actorUserId);
    const [rows] = await this.pool.query<ProductRow[]>(`${PRODUCT_SELECT} WHERE p.seller_id = ? ORDER BY p.updated_at DESC, p.id ASC`, [seller.id]);
    return rows.map((row) => this.productView(row, row.primary_image_id ? [primaryImage(row)] : []));
  }

  public async updateOwnProduct(actorUserId: string, productId: string, input: ProductUpdateInput): Promise<ProductView> {
    const seller = await this.requireApprovedSeller(this.pool, actorUserId);
    return this.updateProduct(actorUserId, productId, input, seller.id);
  }

  public async updateAnyProduct(actorUserId: string, productId: string, input: ProductUpdateInput): Promise<ProductView> {
    return this.updateProduct(actorUserId, productId, input);
  }

  public async setOwnPublication(actorUserId: string, productId: string, status: Exclude<PublicationStatus, 'draft'>): Promise<ProductView> {
    const seller = await this.requireApprovedSeller(this.pool, actorUserId);
    return this.setPublication(actorUserId, productId, status, seller.id);
  }

  public async setAnyPublication(actorUserId: string, productId: string, status: Exclude<PublicationStatus, 'draft'>): Promise<ProductView> {
    return this.setPublication(actorUserId, productId, status);
  }

  public async adjustOwnStock(actorUserId: string, productId: string, delta: number, reason: string, idempotencyKey: string): Promise<object> {
    const seller = await this.requireApprovedSeller(this.pool, actorUserId);
    return this.adjustStock(actorUserId, productId, delta, reason, idempotencyKey, seller.id);
  }

  public async adjustAnyStock(actorUserId: string, productId: string, delta: number, reason: string, idempotencyKey: string): Promise<object> {
    return this.adjustStock(actorUserId, productId, delta, reason, idempotencyKey);
  }

  public async uploadOwnImage(actorUserId: string, productId: string, file: Express.Multer.File, altText: string, sortOrder: number): Promise<ProductImage> {
    const seller = await this.requireApprovedSeller(this.pool, actorUserId);
    const product = await this.findProduct(this.pool, productId);
    if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    if (product.seller_id !== seller.id) throw new AppError(403, 'FORBIDDEN', 'You cannot change another seller’s product');
    const stored = await this.imageStorage.save(productId, file.buffer, file.mimetype);
    const imageId = randomUUID();
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const currentSeller = await this.requireApprovedSeller(connection, actorUserId, true);
      const currentProduct = await this.findProduct(connection, productId, true);
      if (!currentProduct) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
      if (currentProduct.seller_id !== currentSeller.id) throw new AppError(403, 'FORBIDDEN', 'You cannot change another seller’s product');
      const [counts] = await connection.query<CountRow[]>('SELECT COUNT(*) AS count FROM product_images WHERE product_id = ?', [productId]);
      if (Number(counts[0]!.count) >= 10) throw new AppError(409, 'IMAGE_LIMIT_REACHED', 'A product can have at most 10 images');
      await connection.query('INSERT INTO product_images (id, product_id, storage_key, mime_type, size_bytes, alt_text, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)', [imageId, productId, stored.storageKey, stored.mimeType, stored.sizeBytes, altText.trim(), sortOrder]);
      await this.audit(connection, productId, actorUserId, 'product_image_added', { imageId, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, sortOrder });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      await this.imageStorage.remove(stored.storageKey);
      throw error;
    } finally { connection.release(); }
    return { id: imageId, url: imageUrl(productId, imageId), mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, altText: altText.trim(), sortOrder };
  }

  public async listProducts(query: ProductListQuery): Promise<{ products: ProductView[]; pagination: object }> {
    if (query.minPriceMinor !== undefined && query.maxPriceMinor !== undefined && query.minPriceMinor > query.maxPriceMinor) {
      throw new AppError(400, 'INVALID_PRICE_RANGE', 'minPriceMinor cannot exceed maxPriceMinor');
    }
    const where = ["p.publication_status = 'published'", 'c.is_active = TRUE'];
    const values: unknown[] = [];
    if (query.q) {
      const pattern = `%${escapeLike(query.q.trim())}%`;
      where.push("(p.name LIKE ? ESCAPE '\\\\' OR p.description LIKE ? ESCAPE '\\\\' OR p.brand LIKE ? ESCAPE '\\\\')");
      values.push(pattern, pattern, pattern);
    }
    if (query.categoryId) { where.push('p.category_id = ?'); values.push(query.categoryId); }
    if (query.minPriceMinor !== undefined) { where.push('p.price_minor >= ?'); values.push(query.minPriceMinor); }
    if (query.maxPriceMinor !== undefined) { where.push('p.price_minor <= ?'); values.push(query.maxPriceMinor); }
    if (query.brand) { where.push('p.brand = ?'); values.push(query.brand.trim()); }
    if (query.colour) { where.push('p.colour = ?'); values.push(query.colour.trim()); }
    if (query.size) { where.push('p.size_label = ?'); values.push(query.size.trim()); }
    const order = {
      newest: 'p.published_at DESC, p.id ASC',
      price_asc: 'p.price_minor ASC, p.id ASC',
      price_desc: 'p.price_minor DESC, p.id ASC',
      popularity: 'p.paid_units_sold DESC, p.published_at DESC, p.id ASC'
    }[query.sort];
    const clause = where.join(' AND ');
    const [counts] = await this.pool.query<CountRow[]>(`SELECT COUNT(*) AS count FROM products p JOIN categories c ON c.id = p.category_id WHERE ${clause}`, values);
    const total = Number(counts[0]!.count);
    const offset = (query.page - 1) * query.limit;
    const [rows] = await this.pool.query<ProductRow[]>(`${PRODUCT_SELECT} WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`, [...values, query.limit, offset]);
    return {
      products: rows.map((row) => this.productView(row, row.primary_image_id ? [primaryImage(row)] : [])),
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) }
    };
  }

  public async getPublicProduct(productId: string): Promise<ProductView> {
    const [rows] = await this.pool.query<ProductRow[]>(`${PRODUCT_SELECT} WHERE p.id = ? AND p.publication_status = 'published' AND c.is_active = TRUE`, [productId]);
    if (!rows[0]) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    return this.productView(rows[0], await this.listImages(productId));
  }

  public async relatedProducts(productId: string, limit: number): Promise<ProductView[]> {
    const product = await this.getPublicProduct(productId);
    const [rows] = await this.pool.query<ProductRow[]>(`${PRODUCT_SELECT} WHERE p.category_id = ? AND p.id <> ? AND p.publication_status = 'published' AND c.is_active = TRUE ORDER BY p.paid_units_sold DESC, p.published_at DESC, p.id ASC LIMIT ?`, [product.category.id, productId, limit]);
    return rows.map((row) => this.productView(row, row.primary_image_id ? [primaryImage(row)] : []));
  }

  public async getPublicImage(productId: string, imageId: string): Promise<{ bytes: Buffer; mimeType: string }> {
    const [rows] = await this.pool.query<ImageRow[]>(`SELECT pi.* FROM product_images pi JOIN products p ON p.id = pi.product_id JOIN categories c ON c.id = p.category_id
      WHERE pi.id = ? AND pi.product_id = ? AND p.publication_status = 'published' AND c.is_active = TRUE`, [imageId, productId]);
    if (!rows[0]) throw new AppError(404, 'IMAGE_NOT_FOUND', 'Image not found');
    return { bytes: await this.imageStorage.read(rows[0].storage_key), mimeType: rows[0].mime_type };
  }

  private async updateProduct(actorUserId: string, productId: string, input: ProductUpdateInput, requiredSellerId?: string): Promise<ProductView> {
    if (input.categoryId) await this.requireActiveCategory(this.pool, input.categoryId);
    const product = await this.findProduct(this.pool, productId);
    if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    if (requiredSellerId && product.seller_id !== requiredSellerId) throw new AppError(403, 'FORBIDDEN', 'You cannot change another seller’s product');
    const sets: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown): void => { sets.push(`${column} = ?`); values.push(value); };
    if (input.categoryId !== undefined) add('category_id', input.categoryId);
    if (input.name !== undefined) add('name', input.name.trim());
    if (input.description !== undefined) add('description', input.description.trim());
    if (input.priceMinor !== undefined) add('price_minor', input.priceMinor);
    if (input.brand !== undefined) add('brand', cleanOptional(input.brand));
    if (input.colour !== undefined) add('colour', cleanOptional(input.colour));
    if (input.size !== undefined) add('size_label', cleanOptional(input.size));
    if (input.lowStockThreshold !== undefined) add('low_stock_threshold', input.lowStockThreshold);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      if (requiredSellerId) await this.requireApprovedSeller(connection, actorUserId, true);
      const locked = await this.findProduct(connection, productId, true);
      if (!locked) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
      if (requiredSellerId && locked.seller_id !== requiredSellerId) throw new AppError(403, 'FORBIDDEN', 'You cannot change another seller’s product');
      await connection.query(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, [...values, productId]);
      await this.audit(connection, productId, actorUserId, 'product_updated', { fields: Object.keys(input) });
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return this.getProductForActor(productId);
  }

  private async setPublication(actorUserId: string, productId: string, status: Exclude<PublicationStatus, 'draft'>, requiredSellerId?: string): Promise<ProductView> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      if (requiredSellerId) await this.requireApprovedSeller(connection, actorUserId, true);
      const product = await this.findProduct(connection, productId, true);
      if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
      if (requiredSellerId && product.seller_id !== requiredSellerId) throw new AppError(403, 'FORBIDDEN', 'You cannot change another seller’s product');
      if (status === 'published') {
        await this.requireApprovedSellerById(connection, product.seller_id);
        await this.requireActiveCategory(connection, product.category_id);
        const [counts] = await connection.query<CountRow[]>('SELECT COUNT(*) AS count FROM product_images WHERE product_id = ?', [productId]);
        if (Number(counts[0]!.count) === 0) throw new AppError(409, 'PRODUCT_IMAGE_REQUIRED', 'At least one validated image is required before publication');
      }
      if (product.publication_status !== status) {
        await connection.query("UPDATE products SET publication_status = ?, published_at = CASE WHEN ? = 'published' THEN NOW(3) ELSE published_at END WHERE id = ?", [status, status, productId]);
        await this.audit(connection, productId, actorUserId, 'publication_status_changed', { previousStatus: product.publication_status, newStatus: status });
      }
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return this.getProductForActor(productId);
  }

  private async adjustStock(actorUserId: string, productId: string, delta: number, reason: string, idempotencyKey: string, requiredSellerId?: string): Promise<object> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      if (requiredSellerId) await this.requireApprovedSeller(connection, actorUserId, true);
      const product = await this.findProduct(connection, productId, true);
      if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
      if (requiredSellerId && product.seller_id !== requiredSellerId) throw new AppError(403, 'FORBIDDEN', 'You cannot change another seller’s stock');
      const [existing] = await connection.query<AdjustmentRow[]>('SELECT id, delta, previous_quantity, new_quantity FROM stock_adjustments WHERE product_id = ? AND idempotency_key = ?', [productId, idempotencyKey]);
      if (existing[0]) {
        await connection.commit();
        return { adjustmentId: String(existing[0].id), productId, delta: existing[0].delta, previousQuantity: existing[0].previous_quantity, newQuantity: existing[0].new_quantity, idempotentReplay: true };
      }
      const previous = product.stock_quantity;
      const next = previous + delta;
      if (next < 0) throw new AppError(409, 'INSUFFICIENT_STOCK', 'Stock adjustment would make inventory negative');
      if (next > 2_000_000_000) throw new AppError(409, 'STOCK_LIMIT_EXCEEDED', 'Stock adjustment exceeds the supported limit');
      await connection.query('UPDATE products SET stock_quantity = ? WHERE id = ?', [next, productId]);
      const [result] = await connection.query<import('mysql2/promise').ResultSetHeader>('INSERT INTO stock_adjustments (product_id, actor_user_id, idempotency_key, delta, previous_quantity, new_quantity, reason) VALUES (?, ?, ?, ?, ?, ?, ?)', [productId, actorUserId, idempotencyKey, delta, previous, next, reason.trim()]);
      await this.audit(connection, productId, actorUserId, 'stock_adjusted', { adjustmentId: String(result.insertId), delta, previousQuantity: previous, newQuantity: next });
      await connection.commit();
      return { adjustmentId: String(result.insertId), productId, delta, previousQuantity: previous, newQuantity: next, idempotentReplay: false };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  private async getCategory(categoryId: string, activeOnly: boolean): Promise<object> {
    const [rows] = await this.pool.query<CategoryRow[]>(`SELECT * FROM categories WHERE id = ?${activeOnly ? ' AND is_active = TRUE' : ''}`, [categoryId]);
    if (!rows[0]) throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
    return this.categoryView(rows[0]);
  }

  private categoryView(row: CategoryRow): object {
    return { id: row.id, name: row.name, slug: row.slug, isActive: Boolean(row.is_active), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private async getProductForActor(productId: string): Promise<ProductView> {
    const [rows] = await this.pool.query<ProductRow[]>(`${PRODUCT_SELECT} WHERE p.id = ?`, [productId]);
    if (!rows[0]) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    return this.productView(rows[0], await this.listImages(productId));
  }

  private async listImages(productId: string): Promise<ProductImage[]> {
    const [rows] = await this.pool.query<ImageRow[]>('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id', [productId]);
    return rows.map((row) => ({ id: row.id, url: imageUrl(productId, row.id), mimeType: row.mime_type, sizeBytes: row.size_bytes, altText: row.alt_text, sortOrder: row.sort_order }));
  }

  private productView(row: ProductRow, images: ProductImage[]): ProductView {
    return {
      id: row.id,
      seller: { id: row.seller_id, businessName: row.seller_name },
      category: { id: row.category_id, name: row.category_name, slug: row.category_slug },
      name: row.name,
      slug: row.slug,
      description: row.description,
      priceMinor: Number(row.price_minor),
      brand: row.brand,
      colour: row.colour,
      size: row.size_label,
      publicationStatus: row.publication_status,
      stockQuantity: row.stock_quantity,
      stockAvailable: row.stock_quantity > 0,
      lowStockThreshold: row.low_stock_threshold,
      isLowStock: row.stock_quantity <= row.low_stock_threshold,
      paidUnitsSold: Number(row.paid_units_sold),
      images,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      publishedAt: row.published_at
    };
  }

  private async findProduct(queryable: Queryable, productId: string, lock = false): Promise<ProductRow | undefined> {
    const [rows] = await queryable.query<ProductRow[]>(`${PRODUCT_SELECT} WHERE p.id = ?${lock ? ' FOR UPDATE' : ''}`, [productId]);
    return rows[0];
  }

  private async requireApprovedSeller(queryable: Queryable, userId: string, lock = false): Promise<SellerAccessRow> {
    const [rows] = await queryable.query<SellerAccessRow[]>(`SELECT id, user_id, identity_status, approval_status FROM sellers WHERE user_id = ?${lock ? ' FOR UPDATE' : ''}`, [userId]);
    if (!rows[0]) throw new AppError(403, 'SELLER_PROFILE_REQUIRED', 'A seller profile is required');
    return this.validateSellerAccess(rows[0]);
  }

  private async requireApprovedSellerById(queryable: Queryable, sellerId: string): Promise<SellerAccessRow> {
    const [rows] = await queryable.query<SellerAccessRow[]>('SELECT id, user_id, identity_status, approval_status FROM sellers WHERE id = ?', [sellerId]);
    if (!rows[0]) throw new AppError(404, 'SELLER_NOT_FOUND', 'Seller profile not found');
    return this.validateSellerAccess(rows[0]);
  }

  private validateSellerAccess(seller: SellerAccessRow): SellerAccessRow {
    if (seller.approval_status === 'suspended') throw new AppError(403, 'SELLER_SUSPENDED', 'Suspended sellers cannot manage catalogue items');
    if (seller.identity_status !== 'verified' || seller.approval_status !== 'approved') {
      throw new AppError(403, 'SELLER_NOT_APPROVED', 'Verified and approved seller status is required');
    }
    return seller;
  }

  private async requireActiveCategory(queryable: Queryable, categoryId: string): Promise<void> {
    const [rows] = await queryable.query<CategoryRow[]>('SELECT id FROM categories WHERE id = ? AND is_active = TRUE', [categoryId]);
    if (!rows[0]) throw new AppError(409, 'CATEGORY_UNAVAILABLE', 'An active category is required');
  }

  private async audit(connection: PoolConnection, productId: string, actorUserId: string, action: string, metadata: object): Promise<void> {
    await connection.query('INSERT INTO product_audit_events (product_id, actor_user_id, action, metadata) VALUES (?, ?, ?, ?)', [productId, actorUserId, action, JSON.stringify(metadata)]);
  }
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
  if (!slug) throw new AppError(400, 'INVALID_SLUG', 'Name must contain letters or numbers');
  return slug;
}

function cleanOptional(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.trim() || null;
}

function escapeLike(value: string): string { return value.replace(/[\\%_]/g, (character) => `\\${character}`); }
function imageUrl(productId: string, imageId: string): string { return `/api/v1/products/${productId}/images/${imageId}`; }
function isDuplicate(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY'; }

function primaryImage(row: ProductRow): ProductImage {
  return {
    id: row.primary_image_id!,
    url: imageUrl(row.id, row.primary_image_id!),
    mimeType: row.primary_image_mime!,
    sizeBytes: row.primary_image_size!,
    altText: row.primary_image_alt!,
    sortOrder: row.primary_image_order!
  };
}
