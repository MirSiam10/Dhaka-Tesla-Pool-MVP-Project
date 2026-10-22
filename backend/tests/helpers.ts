import bcrypt from 'bcryptjs';
import request from 'supertest';
import { pool } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';
import { createApp } from '../src/app';

export const app = createApp();
export const PASSWORD = 'tesla-pass-123';

export async function setupDatabase() {
  await runMigrations();
}

/** Wipes everything except reference data (zones). Call in beforeEach. */
export async function resetData() {
  await pool.query(
    'TRUNCATE ride_events, payments, ride_requests, pools, vehicles, users RESTART IDENTITY CASCADE',
  );
}

export interface Actor {
  id: string;
  token: string;
  name: string;
  vehicleId?: string;
}

export async function registerPassenger(name: string, email = `${name.toLowerCase()}@example.com`): Promise<Actor> {
  const res = await request(app).post('/api/auth/register').send({ name, email, password: PASSWORD });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  return { id: res.body.user.id, token: res.body.token, name };
}

/** Drivers are seeded in the real app (assumption A8), so tests insert them directly. */
export async function createDriver(
  name = 'Jashim',
  vehicle = { name: 'Bullet', plate: 'DHAKA-METRO-BULLET', capacity: 3 },
): Promise<Actor> {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const u = await pool.query(
    "INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,'DRIVER') RETURNING id",
    [name, `${name.toLowerCase()}@example.com`, hash],
  );
  const v = await pool.query(
    'INSERT INTO vehicles (driver_id,name,plate,capacity) VALUES ($1,$2,$3,$4) RETURNING id',
    [u.rows[0].id, vehicle.name, vehicle.plate, vehicle.capacity],
  );
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: `${name.toLowerCase()}@example.com`, password: PASSWORD });
  return { id: u.rows[0].id, token: res.body.token, name, vehicleId: v.rows[0].id };
}

export const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });

// --- thin wrappers over the HTTP API so tests read like the Banani story ---
export const goOnline = (d: Actor) => request(app).post('/api/driver/status').set(as(d)).send({ online: true });
export const goOffline = (d: Actor) => request(app).post('/api/driver/status').set(as(d)).send({ online: false });
export const requestRide = (p: Actor, body: object) => request(app).post('/api/rides').set(as(p)).send(body);
export const getRide = (p: Actor, id: string) => request(app).get(`/api/rides/${id}`).set(as(p));
export const cancelRide = (p: Actor, id: string) => request(app).post(`/api/rides/${id}/cancel`).set(as(p));
export const acceptRide = (d: Actor, id: string) => request(app).post(`/api/driver/requests/${id}/accept`).set(as(d));
export const driverPool = (d: Actor) => request(app).get('/api/driver/pool').set(as(d));

export const BANANI_TO_MOHAKHALI = { pickupZone: 'BANANI', destinationZone: 'MOHAKHALI' };
export const BANANI_TO_GULSHAN = { pickupZone: 'BANANI', destinationZone: 'GULSHAN_1' };
