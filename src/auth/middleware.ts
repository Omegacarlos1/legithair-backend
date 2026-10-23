import type { RequestHandler } from 'express';
import { AppError } from '../http/errors.js';
import type { AuthService } from './service.js';

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
