import { createHash, randomBytes, randomUUID } from 'node:crypto';

export function createOpaqueToken(): { id: string; raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { id: randomUUID(), raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}
