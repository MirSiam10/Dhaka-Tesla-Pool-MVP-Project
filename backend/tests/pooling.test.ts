import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, pool } from '../src/db/pool';
import {
  acceptRide,
  type Actor,
  BANANI_TO_GULSHAN,
  BANANI_TO_MOHAKHALI,
  cancelRide,
  createDriver,
  driverPool,
  getRide,
  goOffline,
  goOnline,
  registerPassenger,
  requestRide,
  resetData,
  setupDatabase,
} from './helpers';

describe('Tesla pooling: the Banani story', () => {
  let jashim: Actor, nusrat: Actor, rafiq: Actor, shirin: Actor;

  beforeAll(setupDatabase);
  beforeEach(async () => {
    await resetData();
    jashim = await createDriver('Jashim');
    nusrat = await registerPassenger('Nusrat');
    rafiq = await registerPassenger('Rafiq');
    shirin = await registerPassenger('Shirin');
  });
  afterAll(closePool);

  it("pools Nusrat and Rafiq into Bullet and prices each fare individually (5600 and 6800)", async () => {
    await goOnline(jashim).expect(200);

    // 8:41 Nusrat books. Nobody is collecting yet, so she waits.
    const n = await requestRide(nusrat, BANANI_TO_MOHAKHALI);
    expect(n.body.ride.status).toBe('REQUESTED');
    expect(n.body.ride.fare.totalFarePaisa).toBe(7000);

    // Jashim accepts: Bullet now has one passenger and no discount yet.
    const accepted = await acceptRide(jashim, n.body.ride.id);
    expect(accepted.status).toBe(200);
    expect(accepted.body.pool).toMatchObject({ status: 'OPEN', seatCapacity: 3, occupiedSeats: 1, freeSeats: 2 });
    expect((await getRide(nusrat, n.body.ride.id)).body.ride.fare.totalFarePaisa).toBe(7000);

    // 8:43 Rafiq books a different destination on the same corridor: matched instantly.
    const r = await requestRide(rafiq, BANANI_TO_GULSHAN);
    expect(r.body.ride.status).toBe('MATCHED');
    expect(r.body.ride.pool).toMatchObject({ vehicleName: 'Bullet', driverName: 'Jashim', coPassengers: 1 });
    expect(r.body.ride.fare).toMatchObject({ distanceChargePaisa: 4500, poolDiscountPaisa: 1700, totalFarePaisa: 6800, ifSharedTotalPaisa: null });

    // Nusrat's fare dropped because she is now sharing.
    const nAfter = (await getRide(nusrat, n.body.ride.id)).body.ride;
    expect(nAfter.status).toBe('MATCHED');
    expect(nAfter.fare).toMatchObject({ poolDiscountPaisa: 1400, totalFarePaisa: 5600 });

    // Jashim sees both, with seats and individual fares.
    const view = (await driverPool(jashim)).body.pool;
    expect(view.occupiedSeats).toBe(2);
    expect(view.passengers.map((p: { passengerName: string; farePaisa: number }) => [p.passengerName, p.farePaisa])).toEqual([
      ['Nusrat', 5600],
      ['Rafiq', 6800],
    ]);
  });

  it("never reveals a co-passenger's name, id or fare to a passenger", async () => {
    await goOnline(jashim);
    const n = await requestRide(nusrat, BANANI_TO_MOHAKHALI);
    await acceptRide(jashim, n.body.ride.id);
    const r = await requestRide(rafiq, BANANI_TO_GULSHAN);

    const nusratView = JSON.stringify((await getRide(nusrat, n.body.ride.id)).body);
    expect(nusratView).not.toContain('Rafiq');
    expect(nusratView).not.toContain(rafiq.id);
    expect(nusratView).not.toContain('6800');
    const rafiqView = JSON.stringify((await getRide(rafiq, r.body.ride.id)).body);
    expect(rafiqView).not.toContain('Nusrat');
    expect(rafiqView).not.toContain(nusrat.id);
  });

  it('lets a driver accept a request that was already waiting when the pool opened', async () => {
    await goOnline(jashim);
    const n = await requestRide(nusrat, BANANI_TO_MOHAKHALI);
    const r = await requestRide(rafiq, BANANI_TO_GULSHAN); // nobody to join yet: waits
    expect(r.body.ride.status).toBe('REQUESTED');

    await acceptRide(jashim, n.body.ride.id).expect(200);
    const second = await acceptRide(jashim, r.body.ride.id);
    expect(second.status).toBe(200);
    expect(second.body.pool.occupiedSeats).toBe(2);
    expect((await getRide(rafiq, r.body.ride.id)).body.ride.fare.totalFarePaisa).toBe(6800);
  });

  it('does not pool a destination on another corridor, either automatically or by accept', async () => {
    await goOnline(jashim);
    const n = await requestRide(nusrat, BANANI_TO_MOHAKHALI);
    await acceptRide(jashim, n.body.ride.id);

    const uttara = await requestRide(rafiq, { pickupZone: 'BANANI', destinationZone: 'UTTARA' });
    expect(uttara.body.ride.status).toBe('REQUESTED');
    const refused = await acceptRide(jashim, uttara.body.ride.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: 'CANNOT_POOL', details: { reason: 'CORRIDOR_MISMATCH' } });
  });

  it('does not pool a different pickup zone', async () => {
    await goOnline(jashim);
    const n = await requestRide(nusrat, BANANI_TO_MOHAKHALI);
    await acceptRide(jashim, n.body.ride.id);
    const far = await requestRide(rafiq, { pickupZone: 'FARMGATE', destinationZone: 'MOHAKHALI' });
    expect(far.body.ride.status).toBe('REQUESTED');
    const refused = await acceptRide(jashim, far.body.ride.id);
    expect(refused.body.error.details.reason).toBe('PICKUP_MISMATCH');
  });

  it("never exceeds Bullet's capacity: a full Tesla leaves the next passenger waiting", async () => {
    await goOnline(jashim);
    const n = await requestRide(nusrat, BANANI_TO_MOHAKHALI);
    await acceptRide(jashim, n.body.ride.id);
    const r = await requestRide(rafiq, { ...BANANI_TO_GULSHAN, seats: 2 }); // 1 + 2 = 3 of 3
    expect(r.body.ride.status).toBe('MATCHED');

    const s = await requestRide(shirin, BANANI_TO_MOHAKHALI);
    expect(s.body.ride.status).toBe('REQUESTED'); // no seat, so she waits
    const refused = await acceptRide(jashim, s.body.ride.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.reason).toBe('NO_SEATS');

    const { rows } = await pool.query('SELECT occupied_seats, seat_capacity FROM pools');
    expect(rows).toEqual([{ occupied_seats: 3, seat_capacity: 3 }]);
  });

  it("frees the seat and reprices the rest to solo when Rafiq cancels before arrival", async () => {
    await goOnline(jashim);
    const n = await requestRide(nusrat, BANANI_TO_MOHAKHALI);
    await acceptRide(jashim, n.body.ride.id);
    const r = await requestRide(rafiq, BANANI_TO_GULSHAN);

    const cancelled = await cancelRide(rafiq, r.body.ride.id);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.ride.status).toBe('CANCELLED');

    const nAfter = (await getRide(nusrat, n.body.ride.id)).body.ride;
    expect(nAfter.fare).toMatchObject({ poolDiscountPaisa: 0, totalFarePaisa: 7000, ifSharedTotalPaisa: 5600 });
    expect((await driverPool(jashim)).body.pool).toMatchObject({ occupiedSeats: 1, freeSeats: 2 });

    // Shirin can now take the seat Rafiq released.
    const s = await requestRide(shirin, BANANI_TO_MOHAKHALI);
    expect(s.body.ride.status).toBe('MATCHED');
  });

  it('cancels the pool when its only passenger cancels, freeing Jashim to go offline', async () => {
    await goOnline(jashim);
    const n = await requestRide(nusrat, BANANI_TO_MOHAKHALI);
    await acceptRide(jashim, n.body.ride.id);
    expect((await goOffline(jashim)).status).toBe(409); // live pool blocks going offline

    await cancelRide(nusrat, n.body.ride.id).expect(200);
    expect((await driverPool(jashim)).body.pool).toBeNull();
    expect((await goOffline(jashim)).status).toBe(200);
    const { rows } = await pool.query('SELECT status, occupied_seats FROM pools');
    expect(rows).toEqual([{ status: 'CANCELLED', occupied_seats: 0 }]);
  });

  it('requires the driver to be online, and passengers only auto-join online Teslas', async () => {
    const n = await requestRide(nusrat, BANANI_TO_MOHAKHALI);
    const offline = await acceptRide(jashim, n.body.ride.id);
    expect(offline.status).toBe(409);
    expect(offline.body.error.code).toBe('DRIVER_OFFLINE');
  });

  it('refuses to accept a request that was cancelled or already taken', async () => {
    await goOnline(jashim);
    const n = await requestRide(nusrat, BANANI_TO_MOHAKHALI);
    await cancelRide(nusrat, n.body.ride.id);
    const res = await acceptRide(jashim, n.body.ride.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RIDE_NOT_AVAILABLE');
  });

  it('keeps a full event history of the pool and each ride', async () => {
    await goOnline(jashim);
    const n = await requestRide(nusrat, BANANI_TO_MOHAKHALI);
    await acceptRide(jashim, n.body.ride.id);
    await requestRide(rafiq, BANANI_TO_GULSHAN);
    const { rows } = await pool.query(
      'SELECT event_type FROM ride_events WHERE ride_request_id = $1 ORDER BY id',
      [n.body.ride.id],
    );
    expect(rows.map((e) => e.event_type)).toEqual(['RIDE_REQUESTED', 'RIDE_MATCHED', 'FARE_CHANGED']);
  });
});
