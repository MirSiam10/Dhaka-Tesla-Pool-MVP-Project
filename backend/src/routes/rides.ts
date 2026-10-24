import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { authenticate, currentUser, requireRole } from '../middleware/auth';
import * as rides from '../services/rides';

export const ridesRouter = Router();

ridesRouter.use(authenticate, requireRole('PASSENGER'));

const zoneCode = z.string().trim().toUpperCase().min(1).max(40);
const createSchema = z.object({
  pickupZone: zoneCode,
  destinationZone: zoneCode,
  seats: z.number().int().min(1).max(3).default(1),
  paymentMethod: z.enum(['CASH', 'TESLAPAY']).default('CASH'),
});
const idParam = z.object({ id: z.uuid() });

ridesRouter.post('/', async (req, res) => {
  const input = createSchema.parse(req.body);
  res.status(201).json({ ride: await rides.createRide(currentUser(req).id, input) });
});

ridesRouter.get('/', async (req, res) => {
  res.json({ rides: await rides.listRidesForPassenger(currentUser(req).id) });
});

ridesRouter.get('/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const user = currentUser(req);
  res.json({ ride: await rides.getRideForPassenger(pool, user.id, id) });
});

ridesRouter.get('/:id/events', async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({ events: await rides.listRideEvents(currentUser(req).id, id) });
});

ridesRouter.post('/:id/cancel', async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({ ride: await rides.cancelRide(currentUser(req).id, id) });
});
