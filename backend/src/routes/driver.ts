import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { authenticate, currentUser, requireRole } from '../middleware/auth';
import * as driver from '../services/driver';

export const driverRouter = Router();

driverRouter.use(authenticate, requireRole('DRIVER'));

const idParam = z.object({ id: z.uuid() });

driverRouter.get('/me', async (req, res) => {
  res.json(await driver.getProfile(currentUser(req).id));
});

driverRouter.post('/status', async (req, res) => {
  const { online } = z.object({ online: z.boolean() }).parse(req.body);
  res.json(await driver.setOnline(currentUser(req).id, online));
});

driverRouter.get('/requests', async (req, res) => {
  const { zone } = z.object({ zone: z.string().trim().toUpperCase().max(40).optional() }).parse(req.query);
  res.json({ requests: await driver.listOpenRequests(currentUser(req).id, zone) });
});

driverRouter.post('/requests/:id/accept', async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({ pool: await driver.acceptRide(currentUser(req).id, id) });
});

driverRouter.get('/pool', async (req, res) => {
  res.json({ pool: await driver.getActivePoolView(pool, currentUser(req).id) });
});
