import { createHash, randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { AppError } from '../http/errors.js';

interface EligibleItemRow extends RowDataPacket { order_item_id: string; product_id: string }
interface ReviewRow extends RowDataPacket {
  id: string; product_id: string; order_item_id: string; user_id: string; idempotency_key: string; request_hash: string;
  rating: number; title: string; body: string; status: 'pending' | 'published' | 'rejected'; moderation_reason: string | null;
  moderated_by: string | null; moderated_at: Date | null; created_at: Date; updated_at: Date; display_name?: string;
}
interface CountRow extends RowDataPacket { total: number | string; average_rating?: number | string | null }

export interface ReviewInput { orderItemId: string; rating: number; title: string; body: string }
export interface ReviewPage { page: number; limit: number }

export class ReviewService {
  public constructor(private readonly pool: Pool) {}

  public async createReview(userId: string, input: ReviewInput, idempotencyKey: string): Promise<{ review: object; idempotentReplay: boolean }> {
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const connection = await this.pool.getConnection();
    let reviewId: string;
    let replay = false;
    try {
      await connection.beginTransaction();
      const [existing] = await connection.query<ReviewRow[]>('SELECT * FROM product_reviews WHERE user_id = ? AND idempotency_key = ? FOR UPDATE', [userId, idempotencyKey]);
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was already used with different review input');
        reviewId = existing[0].id;
        replay = true;
      } else {
        const [eligible] = await connection.query<EligibleItemRow[]>(`SELECT oi.id AS order_item_id, oi.product_id
          FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN seller_suborders so ON so.id = oi.suborder_id
          WHERE oi.id = ? AND o.user_id = ? AND so.fulfilled_at IS NOT NULL
            AND so.status IN ('delivered','picked_up','returned','refunded')
            AND ((o.payment_method = 'paystack' AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status = 'succeeded'))
              OR (o.payment_method = 'cod' AND EXISTS (SELECT 1 FROM cod_collections cc WHERE cc.order_id = o.id AND cc.status = 'confirmed')))
          FOR UPDATE`, [input.orderItemId, userId]);
        const item = eligible[0];
        if (!item) throw new AppError(403, 'REVIEW_PURCHASE_REQUIRED', 'A completed purchase of this item is required to review it');
        reviewId = randomUUID();
        try {
          await connection.query(`INSERT INTO product_reviews (id, product_id, order_item_id, user_id, idempotency_key, request_hash, rating, title, body)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [reviewId, item.product_id, item.order_item_id, userId, idempotencyKey, requestHash, input.rating, input.title.trim(), input.body.trim()]);
        } catch (error) {
          if (isDuplicate(error)) throw new AppError(409, 'REVIEW_ALREADY_EXISTS', 'This customer has already reviewed the product');
          throw error;
        }
      }
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return { review: await this.getReview(reviewId), idempotentReplay: replay };
  }

  public async listPublic(productId: string, query: ReviewPage): Promise<{ reviews: object[]; summary: object; pagination: object }> {
    const [products] = await this.pool.query<RowDataPacket[]>("SELECT id FROM products WHERE id = ? AND publication_status = 'published'", [productId]);
    if (!products[0]) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    const [counts] = await this.pool.query<CountRow[]>("SELECT COUNT(*) AS total, AVG(rating) AS average_rating FROM product_reviews WHERE product_id = ? AND status = 'published'", [productId]);
    const total = Number(counts[0]!.total);
    const offset = (query.page - 1) * query.limit;
    const [rows] = await this.pool.query<ReviewRow[]>(`SELECT pr.*, u.display_name FROM product_reviews pr JOIN users u ON u.id = pr.user_id
      WHERE pr.product_id = ? AND pr.status = 'published' ORDER BY pr.created_at DESC, pr.id LIMIT ? OFFSET ?`, [productId, query.limit, offset]);
    return {
      reviews: rows.map((row) => this.publicView(row)),
      summary: { count: total, averageRating: counts[0]!.average_rating === null ? null : Number(Number(counts[0]!.average_rating).toFixed(2)) },
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) }
    };
  }

  public async listForModeration(status: 'pending' | 'published' | 'rejected', query: ReviewPage): Promise<{ reviews: object[]; pagination: object }> {
    const [counts] = await this.pool.query<CountRow[]>('SELECT COUNT(*) AS total FROM product_reviews WHERE status = ?', [status]);
    const total = Number(counts[0]!.total);
    const [rows] = await this.pool.query<ReviewRow[]>(`SELECT pr.*, u.display_name FROM product_reviews pr JOIN users u ON u.id = pr.user_id
      WHERE pr.status = ? ORDER BY pr.created_at, pr.id LIMIT ? OFFSET ?`, [status, query.limit, (query.page - 1) * query.limit]);
    return { reviews: rows.map((row) => this.adminView(row)), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }

  public async moderate(actorUserId: string, reviewId: string, status: 'published' | 'rejected', reason: string): Promise<object> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<ReviewRow[]>('SELECT * FROM product_reviews WHERE id = ? FOR UPDATE', [reviewId]);
      const review = rows[0];
      if (!review) throw new AppError(404, 'REVIEW_NOT_FOUND', 'Review not found');
      if (review.status !== status) {
        await connection.query('UPDATE product_reviews SET status = ?, moderation_reason = ?, moderated_by = ?, moderated_at = NOW(3) WHERE id = ?', [status, reason.trim(), actorUserId, reviewId]);
        await connection.query('INSERT INTO review_moderation_events (review_id, from_status, to_status, reason, actor_user_id) VALUES (?, ?, ?, ?, ?)', [reviewId, review.status, status, reason.trim(), actorUserId]);
      }
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return this.getReview(reviewId);
  }

  private async getReview(reviewId: string): Promise<object> {
    const [rows] = await this.pool.query<ReviewRow[]>('SELECT * FROM product_reviews WHERE id = ?', [reviewId]);
    if (!rows[0]) throw new AppError(404, 'REVIEW_NOT_FOUND', 'Review not found');
    return this.adminView(rows[0]);
  }

  private publicView(row: ReviewRow): object {
    return { id: row.id, rating: row.rating, title: row.title, body: row.body, authorName: row.display_name, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private adminView(row: ReviewRow): object {
    return { id: row.id, productId: row.product_id, orderItemId: row.order_item_id, userId: row.user_id, rating: row.rating, title: row.title, body: row.body, status: row.status, moderationReason: row.moderation_reason, moderatedBy: row.moderated_by, moderatedAt: row.moderated_at, createdAt: row.created_at, updatedAt: row.updated_at };
  }
}

function isDuplicate(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY'; }
