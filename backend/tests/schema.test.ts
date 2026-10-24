import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, pool } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';

async function insertDriverWithVehicle(email: string, plate: string, capacity = 3) {
  const u = await pool.query(
    "INSERT INTO users (name,email,password_hash,role) VALUES ('Jashim',$1,'h','DRIVER') RETURNING id",
    [email],
  );
  const v = await pool.query(
    "INSERT INTO vehicles (driver_id,name,plate,capacity) VALUES ($1,'Bullet',$2,$3) RETURNING id",
    [u.rows[0].id, plate, capacity],
  );
  return { driverId: u.rows[0].id as string, vehicleId: v.rows[0].id as string };
}

describe('schema', () => {
  beforeAll(async () => {
    await runMigrations();
  });
  afterAll(async () => {
    await closePool();
  });

  it('seeds the zones and a distance for every unordered pair', async () => {
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM zone_distances)::int AS have,
              (SELECT count(*) FROM zones)::int AS z`,
    );
    expect(rows[0].z).toBe(8);
    expect(rows[0].have).toBe((rows[0].z * (rows[0].z - 1)) / 2);
  });

  it('stores the Banani to Mohakhali distance used in the fare example', async () => {
    const d = await pool.query(
      "SELECT distance_m FROM zone_distances WHERE zone_a = 'BANANI' AND zone_b = 'MOHAKHALI'",
    );
    expect(d.rows[0].distance_m).toBe(2000);
  });

  it('rejects occupied_seats above capacity (database backstop)', async () => {
    const { vehicleId } = await insertDriverWithVehicle('jashim.cap@example.com', 'DHAKA-CAP-1');
    await expect(
      pool.query(
        "INSERT INTO pools (vehicle_id,pickup_zone,corridor,seat_capacity,occupied_seats) VALUES ($1,'BANANI','EAST',3,4)",
        [vehicleId],
      ),
    ).rejects.toThrow(/pools_occupied_within_capacity/);
  });

  it('allows only one active pool per Tesla', async () => {
    const { vehicleId } = await insertDriverWithVehicle('jashim.one@example.com', 'DHAKA-ONE-1');
    const insert = () =>
      pool.query(
        "INSERT INTO pools (vehicle_id,pickup_zone,corridor,seat_capacity) VALUES ($1,'BANANI','EAST',3)",
        [vehicleId],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/pools_one_active_per_vehicle/);
  });

  it('allows only one active ride per passenger', async () => {
    const p = await pool.query(
      "INSERT INTO users (name,email,password_hash,role) VALUES ('Nusrat','nusrat.one@example.com','h','PASSENGER') RETURNING id",
    );
    const insert = () =>
      pool.query(
        `INSERT INTO ride_requests (passenger_id,pickup_zone,destination_zone,seats,base_fare_paisa,distance_charge_paisa,total_fare_paisa)
         VALUES ($1,'BANANI','MOHAKHALI',1,4000,3000,7000)`,
        [p.rows[0].id],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/ride_requests_one_active_per_passenger/);
  });

  it('rejects a fare whose parts do not add up', async () => {
    const p = await pool.query(
      "INSERT INTO users (name,email,password_hash,role) VALUES ('Rafiq','rafiq.fare@example.com','h','PASSENGER') RETURNING id",
    );
    await expect(
      pool.query(
        `INSERT INTO ride_requests (passenger_id,pickup_zone,destination_zone,seats,base_fare_paisa,distance_charge_paisa,total_fare_paisa)
         VALUES ($1,'BANANI','GULSHAN_1',1,4000,4500,1)`,
        [p.rows[0].id],
      ),
    ).rejects.toThrow();
  });

  it('makes ride_events append-only', async () => {
    const { vehicleId } = await insertDriverWithVehicle('jashim.evt@example.com', 'DHAKA-EVT-1');
    const p = await pool.query(
      "INSERT INTO pools (vehicle_id,pickup_zone,corridor,seat_capacity) VALUES ($1,'BANANI','EAST',3) RETURNING id",
      [vehicleId],
    );
    const e = await pool.query(
      "INSERT INTO ride_events (pool_id,event_type) VALUES ($1,'POOL_OPENED') RETURNING id",
      [p.rows[0].id],
    );
    await expect(
      pool.query("UPDATE ride_events SET event_type = 'tampered' WHERE id = $1", [e.rows[0].id]),
    ).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM ride_events WHERE id = $1', [e.rows[0].id])).rejects.toThrow(
      /append-only/,
    );
  });
});
