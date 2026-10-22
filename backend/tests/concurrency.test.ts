import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, pool } from '../src/db/pool';
import {
  acceptRide,
  type Actor,
  BANANI_TO_GULSHAN,
  BANANI_TO_MOHAKHALI,
  cancelRide,
  createDriver,
  goOnline,
  registerPassenger,
  requestRide,
  resetData,
  setupDatabase,
} from './helpers';

// Bullet has 1 seat left. Nusrat and Shirin both try to claim it at the same instant and both
// would have seen "1 seat available". Exactly one may win, and capacity must never be exceeded.
describe('concurrency: the last seat', () => {
  let jashim: Actor;

  beforeAll(setupDatabase);
  beforeEach(async () => {
    await resetData();
    jashim = await createDriver('Jashim');
    await goOnline(jashim);
  });
  afterAll(closePool);

  async function bulletWithOneSeatLeft() {
    const rafiq = await registerPassenger('Rafiq');
    // Rafiq travels with a friend (2 seats) and opens the pool, so Bullet has 1 of 3 free.
    const first = await requestRide(rafiq, { ...BANANI_TO_GULSHAN, seats: 2 });
    await acceptRide(jashim, first.body.ride.id).expect(200);
  }

  async function assertInvariants() {
    const { rows: p } = await pool.query('SELECT occupied_seats, seat_capacity FROM pools');
    for (const row of p) expect(row.occupied_seats).toBeLessThanOrEqual(row.seat_capacity);
    // The denormalised counter must equal the seats actually held by live rides.
    const { rows: drift } = await pool.query(
      `SELECT p.id FROM pools p
        WHERE p.occupied_seats <> COALESCE((SELECT sum(r.seats) FROM ride_requests r
                WHERE r.pool_id = p.id AND r.status IN ('MATCHED','DRIVER_ARRIVED','STARTED')), 0)`,
    );
    expect(drift).toEqual([]);
  }

  it('lets exactly one of Nusrat and Shirin take the last seat', async () => {
    await bulletWithOneSeatLeft();
    const nusrat = await registerPassenger('Nusrat');
    const shirin = await registerPassenger('Shirin');

    const [a, b] = await Promise.all([
      requestRide(nusrat, BANANI_TO_MOHAKHALI),
      requestRide(shirin, BANANI_TO_MOHAKHALI),
    ]);

    expect([a.status, b.status]).toEqual([201, 201]);
    const statuses = [a.body.ride.status, b.body.ride.status].sort();
    expect(statuses).toEqual(['MATCHED', 'REQUESTED']); // one seated, one still waiting
    await assertInvariants();
  });

  it('survives repeated races without ever overbooking', async () => {
    for (let round = 0; round < 5; round++) {
      await resetData();
      jashim = await createDriver('Jashim');
      await goOnline(jashim);
      await bulletWithOneSeatLeft();
      const nusrat = await registerPassenger('Nusrat');
      const shirin = await registerPassenger('Shirin');
      const results = await Promise.all([
        requestRide(nusrat, BANANI_TO_MOHAKHALI),
        requestRide(shirin, BANANI_TO_MOHAKHALI),
      ]);
      const matched = results.filter((r) => r.body.ride.status === 'MATCHED');
      expect(matched).toHaveLength(1);
      await assertInvariants();
    }
  });

  it('seats exactly three single-seat passengers when twelve request at once', async () => {
    const names = ['Nusrat', 'Rafiq', 'Shirin', 'Tania', 'Imran', 'Farhana', 'Kabir', 'Mitu', 'Sohan', 'Lamia', 'Arif', 'Nadia'];
    const riders = await Promise.all(names.map((n) => registerPassenger(n)));
    // Open an empty-ish pool first so everyone is competing for Bullet's three seats.
    const opener = await registerPassenger('Opener');
    const o = await requestRide(opener, BANANI_TO_MOHAKHALI);
    await acceptRide(jashim, o.body.ride.id).expect(200); // 1 seat used, 2 free

    const results = await Promise.all(riders.map((r) => requestRide(r, BANANI_TO_MOHAKHALI)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(results.filter((r) => r.body.ride.status === 'MATCHED')).toHaveLength(2);
    expect(results.filter((r) => r.body.ride.status === 'REQUESTED')).toHaveLength(10);
    await assertInvariants();
  });

  it('lets only one of two simultaneous driver accepts win the same request', async () => {
    const ibrahim = await createDriver('Ibrahim', { name: 'Thunder', plate: 'DHAKA-METRO-THUNDER', capacity: 3 });
    await goOnline(ibrahim);
    const nusrat = await registerPassenger('Nusrat');
    const n = await requestRide(nusrat, BANANI_TO_MOHAKHALI);
    // Jashim is online but has no pool yet, so the ride is waiting. Both drivers tap accept.
    const [a, b] = await Promise.all([acceptRide(jashim, n.body.ride.id), acceptRide(ibrahim, n.body.ride.id)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM pools WHERE status = 'OPEN'");
    expect(rows[0].n).toBe(1); // the loser's pool was rolled back with its transaction
    await assertInvariants();
  });

  it('stays consistent when a passenger cancels at the instant a driver accepts', async () => {
    const nusrat = await registerPassenger('Nusrat');
    const n = await requestRide(nusrat, BANANI_TO_MOHAKHALI);
    const [acc, can] = await Promise.all([acceptRide(jashim, n.body.ride.id), cancelRide(nusrat, n.body.ride.id)]);

    // Either order is fine, but the end state must be the same: the passenger's cancel always wins.
    expect(can.status).toBe(200);
    expect([200, 409]).toContain(acc.status);
    const { rows } = await pool.query('SELECT status FROM ride_requests');
    expect(rows).toEqual([{ status: 'CANCELLED' }]);
    const { rows: pools } = await pool.query("SELECT count(*)::int AS n FROM pools WHERE status IN ('OPEN','DRIVER_ARRIVED','STARTED')");
    expect(pools[0].n).toBe(0); // no zombie pool holding Bullet
    await assertInvariants();
  });
});
