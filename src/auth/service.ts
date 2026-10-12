import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { AppError } from '../http/errors.js';
import { createOpaqueToken, hashToken } from './token.js';
import type { AuthenticatedUser, IssuedTokens, Role } from './types.js';

interface UserRow extends RowDataPacket { id: string; email: string; password_hash: string; display_name: string; email_verified_at: Date | null }
interface TokenRow extends RowDataPacket { id: string; user_id: string; family_id: string | null; used_at: Date | null; revoked_at: Date | null; expires_at: Date }
interface RoleRow extends RowDataPacket { role: Role }
const ACCESS_SECONDS = 15 * 60;
const REFRESH_SECONDS = 30 * 24 * 60 * 60;

export class AuthService {
  public constructor(private readonly pool: Pool) {}

  public async register(input: { email: string; password: string; displayName: string }): Promise<{ userId: string }> {
    const email = input.email.trim().toLowerCase();
    const userId = randomUUID();
    const verification = createOpaqueToken();
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)', [userId, email, passwordHash, input.displayName.trim()]);
      await connection.query('INSERT INTO user_roles (user_id, role) VALUES (?, ?)', [userId, 'customer']);
      await connection.query("INSERT INTO auth_tokens (id, user_id, token_hash, token_type, expires_at) VALUES (?, ?, ?, 'email_verification', DATE_ADD(NOW(3), INTERVAL 24 HOUR))", [verification.id, userId, verification.hash]);
      await connection.query("INSERT INTO durable_jobs (queue_name, job_type, payload) VALUES ('email', 'send_verification', ?)", [JSON.stringify({ to: email, userId, token: verification.raw })]);
      await connection.commit();
      return { userId };
    } catch (error) {
      await connection.rollback();
      if (this.isDuplicate(error)) throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists');
      throw error;
    } finally { connection.release(); }
  }

  public async verifyEmail(rawToken: string): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const token = await this.lockToken(connection, rawToken, 'email_verification');
      await connection.query('UPDATE auth_tokens SET used_at = NOW(3) WHERE id = ?', [token.id]);
      await connection.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW(3)) WHERE id = ?', [token.user_id]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  public async login(emailInput: string, password: string): Promise<{ user: AuthenticatedUser; tokens: IssuedTokens }> {
    const [rows] = await this.pool.query<UserRow[]>('SELECT * FROM users WHERE email = ?', [emailInput.trim().toLowerCase()]);
    const user = rows[0];
    if (!user || !(await argon2.verify(user.password_hash, password))) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    if (!user.email_verified_at) throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before signing in');
    return { user: await this.toUser(user), tokens: await this.issueSession(user.id) };
  }

  public async refresh(rawRefreshToken: string): Promise<IssuedTokens> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<TokenRow[]>("SELECT * FROM auth_tokens WHERE token_hash = ? AND token_type = 'refresh' FOR UPDATE", [hashToken(rawRefreshToken)]);
      const old = rows[0];
      if (!old) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid');
      if (old.used_at || old.revoked_at) {
        if (old.family_id) await connection.query('UPDATE auth_tokens SET revoked_at = COALESCE(revoked_at, NOW(3)) WHERE family_id = ?', [old.family_id]);
        await connection.commit();
        throw new AppError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token reuse detected; session revoked');
      }
      if (new Date(old.expires_at).getTime() <= Date.now()) throw new AppError(401, 'REFRESH_TOKEN_EXPIRED', 'Refresh token has expired');
      await connection.query('UPDATE auth_tokens SET used_at = NOW(3) WHERE id = ?', [old.id]);
      const tokens = await this.issueSessionWithConnection(connection, old.user_id, old.family_id ?? randomUUID(), old.id);
      await connection.commit();
      return tokens;
    } catch (error) { if ((error as AppError).code !== 'REFRESH_TOKEN_REUSED') await connection.rollback(); throw error; } finally { connection.release(); }
  }

  public async logout(rawAccessToken: string): Promise<void> {
    await this.pool.query("UPDATE auth_tokens SET revoked_at = NOW(3) WHERE token_hash = ? AND token_type = 'access'", [hashToken(rawAccessToken)]);
  }

  public async requestPasswordReset(emailInput: string): Promise<void> {
    const email = emailInput.trim().toLowerCase();
    const [users] = await this.pool.query<UserRow[]>('SELECT * FROM users WHERE email = ?', [email]);
    const user = users[0];
    if (!user) return;
    const token = createOpaqueToken();
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query("UPDATE auth_tokens SET revoked_at = NOW(3) WHERE user_id = ? AND token_type = 'password_reset' AND used_at IS NULL", [user.id]);
      await connection.query("INSERT INTO auth_tokens (id, user_id, token_hash, token_type, expires_at) VALUES (?, ?, ?, 'password_reset', DATE_ADD(NOW(3), INTERVAL 1 HOUR))", [token.id, user.id, token.hash]);
      await connection.query("INSERT INTO durable_jobs (queue_name, job_type, payload) VALUES ('email', 'send_password_reset', ?)", [JSON.stringify({ to: email, userId: user.id, token: token.raw })]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  public async resetPassword(rawToken: string, password: string): Promise<void> {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const token = await this.lockToken(connection, rawToken, 'password_reset');
      await connection.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, token.user_id]);
      await connection.query('UPDATE auth_tokens SET used_at = NOW(3) WHERE id = ?', [token.id]);
      await connection.query("UPDATE auth_tokens SET revoked_at = COALESCE(revoked_at, NOW(3)) WHERE user_id = ? AND token_type IN ('access', 'refresh')", [token.user_id]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  public async authenticate(rawToken: string): Promise<AuthenticatedUser> {
    const [tokens] = await this.pool.query<TokenRow[]>("SELECT * FROM auth_tokens WHERE token_hash = ? AND token_type = 'access' AND revoked_at IS NULL AND expires_at > NOW(3)", [hashToken(rawToken)]);
    const token = tokens[0];
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required');
    const [users] = await this.pool.query<UserRow[]>('SELECT * FROM users WHERE id = ?', [token.user_id]);
    if (!users[0]) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required');
    return this.toUser(users[0]);
  }

  private async issueSession(userId: string): Promise<IssuedTokens> {
    const connection = await this.pool.getConnection();
    try { return await this.issueSessionWithConnection(connection, userId, randomUUID(), null); } finally { connection.release(); }
  }

  private async issueSessionWithConnection(connection: PoolConnection, userId: string, familyId: string, parentId: string | null): Promise<IssuedTokens> {
    const access = createOpaqueToken(); const refresh = createOpaqueToken();
    await connection.query("INSERT INTO auth_tokens (id, user_id, token_hash, token_type, expires_at) VALUES (?, ?, ?, 'access', DATE_ADD(NOW(3), INTERVAL ? SECOND))", [access.id, userId, access.hash, ACCESS_SECONDS]);
    await connection.query("INSERT INTO auth_tokens (id, user_id, token_hash, token_type, family_id, parent_id, expires_at) VALUES (?, ?, ?, 'refresh', ?, ?, DATE_ADD(NOW(3), INTERVAL ? SECOND))", [refresh.id, userId, refresh.hash, familyId, parentId, REFRESH_SECONDS]);
    return { accessToken: access.raw, refreshToken: refresh.raw, tokenType: 'Bearer', expiresIn: ACCESS_SECONDS };
  }

  private async lockToken(connection: PoolConnection, raw: string, type: 'email_verification' | 'password_reset'): Promise<TokenRow> {
    const [rows] = await connection.query<TokenRow[]>('SELECT * FROM auth_tokens WHERE token_hash = ? AND token_type = ? FOR UPDATE', [hashToken(raw), type]);
    const token = rows[0];
    if (!token || token.used_at || token.revoked_at) throw new AppError(400, 'TOKEN_INVALID_OR_USED', 'Token is invalid or has already been used');
    if (new Date(token.expires_at).getTime() <= Date.now()) throw new AppError(400, 'TOKEN_EXPIRED', 'Token has expired');
    return token;
  }

  private async toUser(row: UserRow): Promise<AuthenticatedUser> {
    const [roles] = await this.pool.query<RoleRow[]>('SELECT role FROM user_roles WHERE user_id = ?', [row.id]);
    return { id: row.id, email: row.email, displayName: row.display_name, emailVerified: Boolean(row.email_verified_at), roles: roles.map((item) => item.role) };
  }

  private isDuplicate(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY'; }
}
