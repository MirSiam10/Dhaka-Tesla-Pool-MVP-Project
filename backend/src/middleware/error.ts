import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors';
import { logger } from '../logger';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
};

// Postgres constraint violations that mean "the client asked for something conflicting",
// not "the server is broken". Each maps to a stable API error code.
const PG_CONFLICTS: Record<string, { code: string; message: string }> = {
  ride_requests_one_active_per_passenger: {
    code: 'ACTIVE_RIDE_EXISTS',
    message: 'You already have an active ride. Finish or cancel it first.',
  },
  pools_one_active_per_vehicle: {
    code: 'ACTIVE_POOL_EXISTS',
    message: 'This Tesla already has an active pool.',
  },
  users_email_lower_uq: { code: 'EMAIL_TAKEN', message: 'That email is already registered.' },
  pools_occupied_within_capacity: {
    code: 'POOL_FULL',
    message: 'Not enough free seats in this Tesla.',
  },
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
    return;
  }
  const constraint: string | undefined = err?.constraint;
  if (err?.code === '23505' || err?.code === '23514') {
    const mapped = constraint ? PG_CONFLICTS[constraint] : undefined;
    if (mapped) {
      res.status(409).json({ error: mapped });
      return;
    }
  }
  logger.error({ err, method: req.method, url: req.originalUrl }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
};
