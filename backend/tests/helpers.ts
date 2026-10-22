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
