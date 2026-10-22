import type { RequestHandler } from 'express';
import { forbidden, unauthorized } from '../errors';
import { type AuthUser, type Role, verifyToken } from '../services/auth';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/** Requires `Authorization: Bearer <jwt>` and attaches `req.user`. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) throw unauthorized();
  req.user = verifyToken(token);
  next();
};

/** Role gate. Always mount after `authenticate`. */
export const requireRole =
  (role: Role): RequestHandler =>
  (req, _res, next) => {
    if (req.user?.role !== role) throw forbidden(`This action is for ${role.toLowerCase()}s only`);
    next();
  };

/** Handy inside route handlers: `req.user` is guaranteed after `authenticate`. */
export function currentUser(req: { user?: AuthUser }): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
