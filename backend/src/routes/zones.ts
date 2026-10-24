import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { badRequest } from '../errors';
import { calculateFare, FARE_RULES } from '../fare/fare';
import { getDistanceM, getZone, listZones } from '../services/zones';

export const zonesRouter = Router();

zonesRouter.get('/zones', async (_req, res) => {
  res.json({ zones: await listZones() });
});

const estimateSchema = z.object({
  pickup: z.string().trim().toUpperCase().min(1),
  destination: z.string().trim().toUpperCase().min(1),
  seats: z.coerce.number().int().min(1).max(6).default(1),
});

// Public so the booking form can show a price before the passenger signs up or commits.
zonesRouter.get('/fare/estimate', async (req, res) => {
  const q = estimateSchema.parse(req.query);
  if (q.pickup === q.destination) throw badRequest('SAME_ZONE', 'Pickup and destination must differ');
  await Promise.all([getZone(pool, q.pickup), getZone(pool, q.destination)]);
  const distanceM = await getDistanceM(pool, q.pickup, q.destination);
  res.json({
    pickup: q.pickup,
    destination: q.destination,
    seats: q.seats,
    distanceM,
    solo: calculateFare({ distanceM, seats: q.seats, shared: false }),
    shared: calculateFare({ distanceM, seats: q.seats, shared: true }),
    rules: FARE_RULES,
  });
});
