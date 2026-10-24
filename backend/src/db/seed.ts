import bcrypt from 'bcryptjs';
import { config } from '../config';
import { closePool, pool } from './pool';
import { logger } from '../logger';

/**
 * Demo data: the Banani rush-hour cast from the brief. Idempotent, so it is safe to run on
 * every container start. Zones and distances are reference data and ship in the migrations.
 */
export const DEMO_PASSWORD = process.env.SEED_PASSWORD || 'Tesla@1234';

const PASSENGERS = [
  { name: 'Nusrat', email: 'nusrat@example.com', phone: '01711-000001' },
  { name: 'Rafiq', email: 'rafiq@example.com', phone: '01711-000002' },
  { name: 'Shirin', email: 'shirin@example.com', phone: '01711-000003' },
];

const DRIVERS = [
  { name: 'Jashim', email: 'jashim@example.com', phone: '01811-000001', vehicle: { name: 'Bullet', plate: 'DHAKA-METRO-BULLET', capacity: 3 } },
];

const WALLET_PAISA = 50_000; // 500.00 taka of simulated TeslaPay credit

export async function runSeed(): Promise<{ passengers: number; drivers: number }> {
  const hash = await bcrypt.hash(DEMO_PASSWORD, config.BCRYPT_COST);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of PASSENGERS) {
      await client.query(
        `INSERT INTO users (name, email, phone, password_hash, role, wallet_paisa)
         VALUES ($1, $2, $3, $4, 'PASSENGER', $5)
         ON CONFLICT (lower(email)) DO NOTHING`,
        [p.name, p.email, p.phone, hash, WALLET_PAISA],
      );
    }
    for (const d of DRIVERS) {
      const u = await client.query(
        `INSERT INTO users (name, email, phone, password_hash, role)
         VALUES ($1, $2, $3, $4, 'DRIVER')
         ON CONFLICT (lower(email)) DO UPDATE SET name = users.name
         RETURNING id`,
        [d.name, d.email, d.phone, hash],
      );
      await client.query(
        `INSERT INTO vehicles (driver_id, name, plate, capacity)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (driver_id) DO NOTHING`,
        [u.rows[0].id, d.vehicle.name, d.vehicle.plate, d.vehicle.capacity],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  logger.info({ passengers: PASSENGERS.length, drivers: DRIVERS.length }, 'seed data ensured');
  return { passengers: PASSENGERS.length, drivers: DRIVERS.length };
}

if (require.main === module) {
  runSeed()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log('Seeded: Jashim (driver, Bullet), Nusrat, Rafiq, Shirin');
      return closePool();
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
