import type { RequestHandler } from 'express';
import { AppError } from '../http/errors.js';
import type { AuthService } from './service.js';
import type { Role } from './types.js';

export function requireAuthentication(auth: AuthService): RequestHandler {
  return async (req, _res, next): Promise<void> => {
    try {
      const authorization = req.header('authorization');
      if (!authorization?.startsWith('Bearer ')) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required');
      req.authUser = await auth.authenticate(authorization.slice(7));
      req.accessToken = authorization.slice(7);
      next();
    } catch (error) { next(error); }
  };
}

export function requireRole(role: Role): RequestHandler {
  return (req, _res, next): void => {
    if (!req.authUser?.roles.includes(role)) {
      next(new AppError(403, 'FORBIDDEN', `The ${role} role is required`));
      return;
    }
    next();
  };
}
