import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { AppError } from '../http/errors.js';

interface BannerRow extends RowDataPacket {
  id: string; title: string; subtitle: string | null; image_url: string; target_url: string | null; position: number;
  status: 'draft' | 'active' | 'inactive'; starts_at: Date | null; ends_at: Date | null; created_by: string; updated_by: string;
  created_at: Date; updated_at: Date;
}

export interface BannerInput {
  title: string; subtitle?: string | null; imageUrl: string; targetUrl?: string | null; position?: number;
  status?: 'draft' | 'active' | 'inactive'; startsAt?: Date | null; endsAt?: Date | null;
}

export class MerchandisingService {
  public constructor(private readonly pool: Pool) {}

  public async listPublic(): Promise<object[]> {
    const [rows] = await this.pool.query<BannerRow[]>(`SELECT * FROM homepage_banners WHERE status = 'active'
      AND (starts_at IS NULL OR starts_at <= NOW(3)) AND (ends_at IS NULL OR ends_at > NOW(3))
      ORDER BY position, created_at DESC, id`);
    return rows.map((row) => this.view(row));
  }

  public async listAdmin(): Promise<object[]> {
    const [rows] = await this.pool.query<BannerRow[]>('SELECT * FROM homepage_banners ORDER BY position, created_at DESC, id');
    return rows.map((row) => this.view(row));
  }

  public async create(actorUserId: string, input: BannerInput): Promise<object> {
    validateWindow(input.startsAt, input.endsAt);
    const id = randomUUID();
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(`INSERT INTO homepage_banners (id, title, subtitle, image_url, target_url, position, status, starts_at, ends_at, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, input.title.trim(), clean(input.subtitle), input.imageUrl.trim(), clean(input.targetUrl), input.position ?? 0, input.status ?? 'draft', input.startsAt ?? null, input.endsAt ?? null, actorUserId, actorUserId]);
      await this.audit(connection, id, actorUserId, 'banner_created', { status: input.status ?? 'draft' });
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return this.get(id);
  }

  public async update(actorUserId: string, bannerId: string, input: Partial<BannerInput>): Promise<object> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<BannerRow[]>('SELECT * FROM homepage_banners WHERE id = ? FOR UPDATE', [bannerId]);
      const current = rows[0];
      if (!current) throw new AppError(404, 'BANNER_NOT_FOUND', 'Banner not found');
      const startsAt = input.startsAt === undefined ? current.starts_at : input.startsAt;
      const endsAt = input.endsAt === undefined ? current.ends_at : input.endsAt;
      validateWindow(startsAt, endsAt);
      const fields: string[] = [];
      const values: unknown[] = [];
      const add = (field: string, value: unknown): void => { fields.push(`${field} = ?`); values.push(value); };
      if (input.title !== undefined) add('title', input.title.trim());
      if (input.subtitle !== undefined) add('subtitle', clean(input.subtitle));
      if (input.imageUrl !== undefined) add('image_url', input.imageUrl.trim());
      if (input.targetUrl !== undefined) add('target_url', clean(input.targetUrl));
      if (input.position !== undefined) add('position', input.position);
      if (input.status !== undefined) add('status', input.status);
      if (input.startsAt !== undefined) add('starts_at', input.startsAt);
      if (input.endsAt !== undefined) add('ends_at', input.endsAt);
      add('updated_by', actorUserId);
      await connection.query(`UPDATE homepage_banners SET ${fields.join(', ')} WHERE id = ?`, [...values, bannerId]);
      await this.audit(connection, bannerId, actorUserId, 'banner_updated', { fields: Object.keys(input) });
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return this.get(bannerId);
  }

  private async get(bannerId: string): Promise<object> {
    const [rows] = await this.pool.query<BannerRow[]>('SELECT * FROM homepage_banners WHERE id = ?', [bannerId]);
    if (!rows[0]) throw new AppError(404, 'BANNER_NOT_FOUND', 'Banner not found');
    return this.view(rows[0]);
  }

  private view(row: BannerRow): object {
    return { id: row.id, title: row.title, subtitle: row.subtitle, imageUrl: row.image_url, targetUrl: row.target_url, position: row.position, status: row.status, startsAt: row.starts_at, endsAt: row.ends_at, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private async audit(connection: PoolConnection, bannerId: string, actorUserId: string, action: string, metadata: object): Promise<ResultSetHeader> {
    const [result] = await connection.query<ResultSetHeader>('INSERT INTO banner_audit_events (banner_id, action, actor_user_id, metadata) VALUES (?, ?, ?, ?)', [bannerId, action, actorUserId, JSON.stringify(metadata)]);
    return result;
  }
}

function validateWindow(startsAt: Date | null | undefined, endsAt: Date | null | undefined): void {
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) throw new AppError(400, 'INVALID_BANNER_WINDOW', 'Banner end time must be after its start time');
}
function clean(value: string | null | undefined): string | null { return value?.trim() || null; }
