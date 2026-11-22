import { Router, type RequestHandler } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { AuthService } from '../auth/service.js';
import { requireAuthentication, requireRole } from '../auth/middleware.js';
import { AppError } from '../http/errors.js';

const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };
const pagination = z.object({ page: z.coerce.number().int().min(1).max(100_000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });
const staffQuery = pagination.extend({ role: z.enum(['finance', 'support']).optional() }).strict();
const auditQuery = pagination.extend({ source: z.enum(['staff_role', 'seller', 'product', 'delivery_config', 'banner']).optional(), actorUserId: z.uuid().optional(), targetId: z.string().min(1).max(50).optional() }).strict();
const changeSchema = z.object({ role: z.enum(['finance', 'support']), action: z.enum(['grant', 'revoke']), reason: z.string().trim().min(10).max(500) }).strict();
interface StaffRow extends RowDataPacket { id: string; email: string; display_name: string; email_verified_at: Date | null; roles: string | null }
interface AuditRow extends RowDataPacket { id: string; source: string; entity_id: string; actor_user_id: string; action: string; reason: string | null; created_at: Date }
interface CountRow extends RowDataPacket { total: number }
const auditUnion = `
  SELECT CONCAT('staff_role:', id) id, 'staff_role' source, target_user_id entity_id, actor_user_id, CONCAT('role_', action, ':', role) action, reason, created_at FROM staff_role_audit_events
  UNION ALL SELECT CONCAT('seller:', id), 'seller', seller_id, actor_user_id, action, reason, created_at FROM seller_audit_events
  UNION ALL SELECT CONCAT('product:', id), 'product', product_id, actor_user_id, action, NULL, created_at FROM product_audit_events
  UNION ALL SELECT CONCAT('delivery_config:', id), 'delivery_config', entity_id, actor_user_id, action, NULL, created_at FROM delivery_config_audit_events
  UNION ALL SELECT CONCAT('banner:', id), 'banner', banner_id, actor_user_id, action, NULL, created_at FROM banner_audit_events`;

export function createStaffRouter(pool: Pool): Router {
  const router = Router();
  const auth = requireAuthentication(new AuthService(pool));
  const admin = requireRole('admin');
  router.get('/admin/staff', auth, admin, asyncRoute(async (req, res) => {
    const query = staffQuery.parse(req.query);
    const where = query.role ? "WHERE EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = ?)" : "WHERE EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role IN ('admin','finance','support'))";
    const params = query.role ? [query.role] : [];
    const [counts] = await pool.query<CountRow[]>(`SELECT COUNT(*) total FROM users u ${where}`, params);
    const [rows] = await pool.query<StaffRow[]>(`SELECT u.id, u.email, u.display_name, u.email_verified_at, GROUP_CONCAT(r.role ORDER BY r.role) roles FROM users u JOIN user_roles r ON r.user_id = u.id ${where} GROUP BY u.id, u.email, u.display_name, u.email_verified_at ORDER BY u.created_at DESC, u.id DESC LIMIT ? OFFSET ?`, [...params, query.limit, (query.page - 1) * query.limit]);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: { staff: rows.map(staffView) }, meta: { requestId: req.id, pagination: pageMeta(query.page, query.limit, counts[0]?.total ?? 0) } });
  }));
  router.get('/admin/staff/:userId', auth, admin, asyncRoute(async (req, res) => {
    const userId = z.uuid().parse(req.params.userId);
    const [rows] = await pool.query<StaffRow[]>('SELECT u.id, u.email, u.display_name, u.email_verified_at, GROUP_CONCAT(r.role ORDER BY r.role) roles FROM users u JOIN user_roles r ON r.user_id = u.id WHERE u.id = ? GROUP BY u.id, u.email, u.display_name, u.email_verified_at', [userId]);
    if (!rows[0]) throw new AppError(404, 'USER_NOT_FOUND', 'Account not found');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: { staff: staffView(rows[0]) }, meta: { requestId: req.id } });
  }));
  router.patch('/admin/staff/:userId/roles', auth, admin, asyncRoute(async (req, res) => {
    const userId = z.uuid().parse(req.params.userId);
    const body = changeSchema.parse(req.body);
    if (userId === req.authUser!.id) throw new AppError(403, 'SELF_ROLE_CHANGE_FORBIDDEN', 'An admin cannot change their own staff roles');
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [users] = await connection.query<StaffRow[]>('SELECT id, email_verified_at FROM users WHERE id = ? FOR UPDATE', [userId]);
      if (!users[0]) throw new AppError(404, 'USER_NOT_FOUND', 'Account not found');
      if (!users[0].email_verified_at) throw new AppError(409, 'EMAIL_NOT_VERIFIED', 'Staff account must be verified');
      const [roles] = await connection.query<RowDataPacket[]>('SELECT role FROM user_roles WHERE user_id = ? AND role = ?', [userId, body.role]);
      const present = roles.length > 0;
      if (body.action === 'grant' && !present) await connection.query('INSERT INTO user_roles (user_id, role) VALUES (?, ?)', [userId, body.role]);
      if (body.action === 'revoke' && present) await connection.query('DELETE FROM user_roles WHERE user_id = ? AND role = ?', [userId, body.role]);
      const changed = body.action === 'grant' ? !present : present;
      if (changed) {
        await connection.query('INSERT INTO staff_role_audit_events (target_user_id, actor_user_id, role, action, reason) VALUES (?, ?, ?, ?, ?)', [userId, req.authUser!.id, body.role, body.action === 'grant' ? 'granted' : 'revoked', body.reason]);
        await connection.query("UPDATE auth_tokens SET revoked_at = NOW(3) WHERE user_id = ? AND token_type IN ('access', 'refresh') AND revoked_at IS NULL", [userId]);
      }
      await connection.commit();
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data: { userId, role: body.role, assigned: body.action === 'grant', changed }, meta: { requestId: req.id } });
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }));
  router.get('/admin/audit-events', auth, admin, asyncRoute(async (req, res) => {
    const query = auditQuery.parse(req.query);
    const clauses: string[] = []; const params: unknown[] = [];
    if (query.source) { clauses.push('source = ?'); params.push(query.source); }
    if (query.actorUserId) { clauses.push('actor_user_id = ?'); params.push(query.actorUserId); }
    if (query.targetId) { clauses.push('entity_id = ?'); params.push(query.targetId); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [counts] = await pool.query<CountRow[]>(`SELECT COUNT(*) total FROM (${auditUnion}) events ${where}`, params);
    const [rows] = await pool.query<AuditRow[]>(`SELECT id, source, entity_id, actor_user_id, action, reason, created_at FROM (${auditUnion}) events ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [...params, query.limit, (query.page - 1) * query.limit]);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: { events: rows.map(row => ({ id: row.id, source: row.source, targetId: row.entity_id, actorUserId: row.actor_user_id, action: row.action, reason: row.reason, createdAt: row.created_at })) }, meta: { requestId: req.id, pagination: pageMeta(query.page, query.limit, counts[0]?.total ?? 0) } });
  }));
  return router;
}

function staffView(row: StaffRow): object { return { id: row.id, email: row.email, displayName: row.display_name, emailVerified: Boolean(row.email_verified_at), roles: row.roles?.split(',') ?? [] }; }
function pageMeta(page: number, limit: number, total: number): object { return { page, limit, total, totalPages: Math.ceil(total / limit) }; }
