import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { AppError } from '../http/errors.js';
import type { SellerApprovalStatus, SellerIdentityStatus, SellerProfile } from './types.js';

interface SellerRow extends RowDataPacket {
  id: string;
  user_id: string;
  business_name: string;
  phone: string;
  identity_status: SellerIdentityStatus;
  approval_status: SellerApprovalStatus;
  approval_reason: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  suspended_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export class SellerService {
  public constructor(private readonly pool: Pool) {}

  public async create(userId: string, input: { businessName: string; phone: string }): Promise<SellerProfile> {
    const sellerId = randomUUID();
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('INSERT INTO sellers (id, user_id, business_name, phone) VALUES (?, ?, ?, ?)', [sellerId, userId, input.businessName.trim(), input.phone.trim()]);
      await connection.query("INSERT IGNORE INTO user_roles (user_id, role) VALUES (?, 'seller')", [userId]);
      await connection.query("INSERT INTO seller_audit_events (seller_id, actor_user_id, action, new_status, metadata) VALUES (?, ?, 'seller_created', 'pending', ?)", [sellerId, userId, JSON.stringify({ source: 'self_service' })]);
      const seller = await this.findById(connection, sellerId);
      await connection.commit();
      return this.toProfile(seller!);
    } catch (error) {
      await connection.rollback();
      if (this.isDuplicate(error)) throw new AppError(409, 'SELLER_ALREADY_EXISTS', 'A seller profile already exists for this account');
      throw error;
    } finally { connection.release(); }
  }

  public async getByUserId(userId: string): Promise<SellerProfile> {
    const [rows] = await this.pool.query<SellerRow[]>('SELECT * FROM sellers WHERE user_id = ?', [userId]);
    if (!rows[0]) throw new AppError(404, 'SELLER_NOT_FOUND', 'Seller profile not found');
    return this.toProfile(rows[0]);
  }

  public async requestIdentityVerification(userId: string): Promise<never> {
    const seller = await this.getByUserId(userId);
    if (seller.approvalStatus === 'suspended') throw new AppError(403, 'SELLER_SUSPENDED', 'Suspended sellers cannot start identity verification');
    throw new AppError(503, 'IDENTITY_PROVIDER_NOT_CONFIGURED', 'Identity verification is not configured');
  }

  public async updateApprovalStatus(actorUserId: string, sellerId: string, status: SellerApprovalStatus, reason: string): Promise<SellerProfile> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const seller = await this.findById(connection, sellerId, true);
      if (!seller) throw new AppError(404, 'SELLER_NOT_FOUND', 'Seller profile not found');
      if (seller.user_id === actorUserId) throw new AppError(403, 'SELF_APPROVAL_FORBIDDEN', 'Sellers cannot change their own approval status');
      if (status === 'approved' && seller.identity_status !== 'verified') throw new AppError(409, 'IDENTITY_VERIFICATION_REQUIRED', 'Verified identity is required before seller approval');
      if (seller.approval_status === status) {
        await connection.commit();
        return this.toProfile(seller);
      }
      await connection.query(
        `UPDATE sellers SET approval_status = ?, approval_reason = ?,
          approved_by = CASE WHEN ? = 'approved' THEN ? ELSE NULL END,
          approved_at = CASE WHEN ? = 'approved' THEN NOW(3) ELSE NULL END,
          suspended_at = CASE WHEN ? = 'suspended' THEN NOW(3) ELSE NULL END
        WHERE id = ?`,
        [status, reason.trim(), status, actorUserId, status, status, sellerId]
      );
      await connection.query("INSERT INTO seller_audit_events (seller_id, actor_user_id, action, previous_status, new_status, reason, metadata) VALUES (?, ?, 'approval_status_changed', ?, ?, ?, ?)", [sellerId, actorUserId, seller.approval_status, status, reason.trim(), JSON.stringify({ decisionSource: 'admin_api' })]);
      const updated = await this.findById(connection, sellerId);
      await connection.commit();
      return this.toProfile(updated!);
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  private async findById(connection: PoolConnection, sellerId: string, lock = false): Promise<SellerRow | undefined> {
    const [rows] = await connection.query<SellerRow[]>(`SELECT * FROM sellers WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [sellerId]);
    return rows[0];
  }

  private toProfile(row: SellerRow): SellerProfile {
    return {
      id: row.id,
      userId: row.user_id,
      businessName: row.business_name,
      phone: row.phone,
      identityStatus: row.identity_status,
      approvalStatus: row.approval_status,
      approvalReason: row.approval_reason,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      suspendedAt: row.suspended_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private isDuplicate(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY'; }
}
