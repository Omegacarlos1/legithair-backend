import type { AuthenticatedUser } from '../auth/types.js';

declare global {
  namespace Express {
    interface Request { id: string; authUser?: AuthenticatedUser; accessToken?: string }
  }
}
export {};
