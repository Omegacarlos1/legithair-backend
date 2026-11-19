import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { AppError } from '../http/errors.js';

interface AddressRow extends RowDataPacket {
  id: string; user_id: string; label: string; recipient_name: string; phone: string; line1: string; line2: string | null; city: string; state: string; country_code: string; is_default: number;
}

export interface AddressInput { label: string; recipientName: string; phone: string; line1: string; line2?: string; city: string; state: string; countryCode?: string; isDefault?: boolean }
export interface AddressUpdateInput { label?: string; recipientName?: string; phone?: string; line1?: string; line2?: string | null; city?: string; state?: string; countryCode?: string }

type AddressView = {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  countryCode: string;
  isDefault: boolean;
};

export class AddressService {
  public constructor(private readonly pool: Pool) {}
  public async list(userId: string): Promise<AddressView[]> {
    const [rows] = await this.pool.query<AddressRow[]>('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at ASC', [userId]);
    return rows.map(addressView);
  }
  public async create(userId: string, input: AddressInput): Promise<{ id: string }> {
    const id = randomUUID();
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await this.lockOwner(connection, userId);
      if (input.isDefault) await connection.query('UPDATE addresses SET is_default = FALSE WHERE user_id = ?', [userId]);
      await connection.query('INSERT INTO addresses (id, user_id, label, recipient_name, phone, line1, line2, city, state, country_code, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, userId, input.label, input.recipientName, input.phone, input.line1, input.line2 ?? null, input.city, input.state, input.countryCode ?? 'NG', input.isDefault ?? false]);
      await connection.commit(); return { id };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  public async update(userId: string, addressId: string, input: AddressUpdateInput): Promise<AddressView> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await this.lockOwner(connection, userId);
      await this.lockOwned(connection, userId, addressId);
      const sets: string[] = [];
      const values: unknown[] = [];
      addUpdate(sets, values, 'label', input.label);
      addUpdate(sets, values, 'recipient_name', input.recipientName);
      addUpdate(sets, values, 'phone', input.phone);
      addUpdate(sets, values, 'line1', input.line1);
      addUpdate(sets, values, 'line2', input.line2);
      addUpdate(sets, values, 'city', input.city);
      addUpdate(sets, values, 'state', input.state);
      addUpdate(sets, values, 'country_code', input.countryCode);
      if (sets.length === 0) throw new AppError(400, 'ADDRESS_UPDATE_REQUIRED', 'At least one address field is required');
      await connection.query(`UPDATE addresses SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, [...values, addressId, userId]);
      const updated = await this.readOwned(connection, userId, addressId);
      await connection.commit();
      return addressView(updated);
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  public async selectDefault(userId: string, addressId: string): Promise<AddressView> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await this.lockOwner(connection, userId);
      const [rows] = await connection.query<AddressRow[]>('SELECT * FROM addresses WHERE user_id = ? ORDER BY id FOR UPDATE', [userId]);
      if (!rows.some((row) => row.id === addressId)) throw addressNotFound();
      await connection.query('UPDATE addresses SET is_default = (id = ?) WHERE user_id = ?', [addressId, userId]);
      const selected = await this.readOwned(connection, userId, addressId);
      await connection.commit();
      return addressView(selected);
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  private async lockOwned(connection: PoolConnection, userId: string, addressId: string): Promise<void> {
    const [rows] = await connection.query<AddressRow[]>('SELECT * FROM addresses WHERE id = ? AND user_id = ? FOR UPDATE', [addressId, userId]);
    if (!rows[0]) throw addressNotFound();
  }

  private async lockOwner(connection: PoolConnection, userId: string): Promise<void> {
    await connection.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
  }

  private async readOwned(connection: PoolConnection, userId: string, addressId: string): Promise<AddressRow> {
    const [rows] = await connection.query<AddressRow[]>('SELECT * FROM addresses WHERE id = ? AND user_id = ?', [addressId, userId]);
    if (!rows[0]) throw addressNotFound();
    return rows[0];
  }
}

function addUpdate(sets: string[], values: unknown[], column: string, value: unknown): void {
  if (value !== undefined) { sets.push(`${column} = ?`); values.push(value); }
}

function addressView(row: AddressRow): AddressView {
  return { id: row.id, label: row.label, recipientName: row.recipient_name, phone: row.phone, line1: row.line1, line2: row.line2, city: row.city, state: row.state, countryCode: row.country_code, isDefault: Boolean(row.is_default) };
}

function addressNotFound(): AppError {
  return new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found');
}
