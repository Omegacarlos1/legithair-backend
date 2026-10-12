import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';

interface AddressRow extends RowDataPacket {
  id: string; user_id: string; label: string; recipient_name: string; phone: string; line1: string; line2: string | null; city: string; state: string; country_code: string; is_default: number;
}

export interface AddressInput { label: string; recipientName: string; phone: string; line1: string; line2?: string; city: string; state: string; countryCode?: string; isDefault?: boolean }

export class AddressService {
  public constructor(private readonly pool: Pool) {}
  public async list(userId: string): Promise<object[]> {
    const [rows] = await this.pool.query<AddressRow[]>('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at ASC', [userId]);
    return rows.map((row) => ({ id: row.id, label: row.label, recipientName: row.recipient_name, phone: row.phone, line1: row.line1, line2: row.line2, city: row.city, state: row.state, countryCode: row.country_code, isDefault: Boolean(row.is_default) }));
  }
  public async create(userId: string, input: AddressInput): Promise<{ id: string }> {
    const id = randomUUID();
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      if (input.isDefault) await connection.query('UPDATE addresses SET is_default = FALSE WHERE user_id = ?', [userId]);
      await connection.query('INSERT INTO addresses (id, user_id, label, recipient_name, phone, line1, line2, city, state, country_code, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, userId, input.label, input.recipientName, input.phone, input.line1, input.line2 ?? null, input.city, input.state, input.countryCode ?? 'NG', input.isDefault ?? false]);
      await connection.commit(); return { id };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }
}
