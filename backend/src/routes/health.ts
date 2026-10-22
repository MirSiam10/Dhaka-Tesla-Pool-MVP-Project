import { Router } from 'express';
import { query } from '../db/pool';

export const healthRouter = Router();

// Liveness: the process is up. Used by Docker/Render to decide whether to restart.
healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok' });
});

// Readiness: the process can actually serve traffic, i.e. the database answers.
healthRouter.get('/ready', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});
