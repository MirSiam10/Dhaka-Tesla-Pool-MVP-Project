import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, pool } from '../src/db/pool';
import {
  acceptRide,
  type Actor,
  app,
  arrive,
  as,
  BANANI_TO_GULSHAN,
  BANANI_TO_MOHAKHALI,
  cancelPool,
  cancelRide,
  complete,
  createDriver,
  driverHistory,
  driverPool,
  getRide,
  goOnline,
  registerPassenger,
  requestRide,
  resetData,
  rideEvents,
  setupDatabase,
  startTrip,
} from './helpers';

describe('driver flow: arrive, start, complete', () => {
  let jashim: Actor, nusrat: Actor, rafiq: Actor, shirin: Actor;
  let nusratRide: string, rafiqRide: string;

  beforeAll(setupDatabase);
  beforeEach(async () => {
    await resetData();
    jashim = await createDriver('Jashim');
    nusrat = await registerPassenger('Nusrat');
    rafiq = await registerPassenger('Rafiq');
    shirin = await registerPassenger('Shirin');
    await goOnline(jashim);
    nusratRide = (await requestRide(nusrat, BANANI_TO_MOHAKHALI)).body.ride.id;
    await acceptRide(jashim, nusratRide).expect(200);
    rafiqRide = (await requestRide(rafiq, BANANI_TO_GULSHAN)).body.ride.id; // auto-joins
  });
  afterAll(closePool);

  it('runs the whole trip: arrive, start, drop Nusrat, drop Rafiq, pool completes', async () => {
    const arrived = await arrive(jashim);
    expect(arrived.body.pool.status).toBe('DRIVER_ARRIVED');
    expect(arrived.body.pool.passengers.every((p: { status: string }) => p.status === 'DRIVER_ARRIVED')).toBe(true);
    expect((await getRide(nusrat, nusratRide)).body.ride.status).toBe('DRIVER_ARRIVED');

    const started = await startTrip(jashim);
    expect(started.body.pool.status).toBe('STARTED');
    expect((await getRide(rafiq, rafiqRide)).body.ride.status).toBe('STARTED');

    // Nusrat gets off at Mohakhali: her ride completes, the pool keeps going for Rafiq.
    const afterNusrat = await complete(jashim, nusratRide);
    expect(afterNusrat.body.pool.status).toBe('STARTED');
    expect((await getRide(nusrat, nusratRide)).body.ride).toMatchObject({ status: 'COMPLETED', fare: { totalFarePaisa: 5600 } });

    const afterRafiq = await complete(jashim, rafiqRide);
    expect(afterRafiq.body.pool.status).toBe('COMPLETED');
    expect((await getRide(rafiq, rafiqRide)).body.ride).toMatchObject({ status: 'COMPLETED', fare: { totalFarePaisa: 6800 } });

    expect((await driverPool(jashim)).body.pool).toBeNull();
    const history = (await driverHistory(jashim)).body;
    expect(history).toMatchObject({ completedTrips: 2, earningsPaisa: 12400 });
    expect(history.pools[0]).toMatchObject({ status: 'COMPLETED', occupiedSeats: 0 });
  });

  it("explains exactly what happened in Nusrat's ride history", async () => {
    await arrive(jashim);
    await startTrip(jashim);
    await complete(jashim, nusratRide);
    const events = (await rideEvents(nusrat, nusratRide)).body.events;
    expect(events.map((e: { type: string }) => e.type)).toEqual([
      'RIDE_REQUESTED',
      'RIDE_MATCHED',
      'FARE_CHANGED',
      'RIDE_DRIVER_ARRIVED',
      'RIDE_STARTED',
      'RIDE_COMPLETED',
      'PAYMENT_RECORDED',
    ]);
    expect(events[2].metadata).toMatchObject({ fromPaisa: 7000, toPaisa: 5600 });
  });

  it('closes boarding at arrival: nobody can join, and nobody can cancel', async () => {
    await arrive(jashim);

    const late = await requestRide(shirin, BANANI_TO_MOHAKHALI);
    expect(late.body.ride.status).toBe('REQUESTED'); // Bullet is no longer collecting
    const refused = await acceptRide(jashim, late.body.ride.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('POOL_CLOSED');

    const cancel = await cancelRide(nusrat, nusratRide);
    expect(cancel.status).toBe(409);
    expect(cancel.body.error.code).toBe('INVALID_TRANSITION');
    expect((await getRide(nusrat, nusratRide)).body.ride.status).toBe('DRIVER_ARRIVED');
  });

  it('rejects invalid state transitions in the pool lifecycle', async () => {
    // cannot start before arriving
    const early = await startTrip(jashim);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('INVALID_TRANSITION');
    // cannot complete before the trip starts
    expect((await complete(jashim, nusratRide)).status).toBe(409);

    await arrive(jashim).expect(200);
    expect((await arrive(jashim)).status).toBe(409); // arrive twice
    expect((await complete(jashim, nusratRide)).status).toBe(409); // still not started

    await startTrip(jashim).expect(200);
    expect((await startTrip(jashim)).status).toBe(409); // start twice
    expect((await arrive(jashim)).status).toBe(409); // go back

    await complete(jashim, nusratRide).expect(200);
    expect((await complete(jashim, nusratRide)).status).toBe(409); // complete twice
  });

  it('keeps a driver out of another driver’s pool', async () => {
    const ibrahim = await createDriver('Ibrahim', { name: 'Thunder', plate: 'DHAKA-METRO-THUNDER', capacity: 3 });
    await goOnline(ibrahim);
    expect((await arrive(ibrahim)).body.error.code).toBe('NO_ACTIVE_POOL');
    // Ibrahim has his own pool, but Nusrat's ride is not in it
    const s = await requestRide(shirin, { pickupZone: 'FARMGATE', destinationZone: 'DHANMONDI' });
    await acceptRide(ibrahim, s.body.ride.id).expect(200);
    await arrive(ibrahim);
    await startTrip(ibrahim);
    const res = await complete(ibrahim, nusratRide);
    expect(res.status).toBe(404);
    expect((await getRide(nusrat, nusratRide)).body.ride.status).toBe('MATCHED');
  });

  it('enforces roles on both sides', async () => {
    expect((await request(app).post('/api/driver/pool/arrive').set(as(nusrat))).status).toBe(403);
    expect((await request(app).get('/api/rides').set(as(jashim))).status).toBe(403);
    expect((await request(app).post('/api/driver/pool/arrive')).status).toBe(401);
  });

  it('debits a TeslaPay wallet on completion and records the payment', async () => {
    // Shirin pays with TeslaPay and shares Bullet (same pickup and corridor).
    const s = await requestRide(shirin, { ...BANANI_TO_MOHAKHALI, paymentMethod: 'TESLAPAY' });
    expect(s.body.ride.status).toBe('MATCHED');
    const fare = (await getRide(shirin, s.body.ride.id)).body.ride.fare.totalFarePaisa;
    expect(fare).toBe(5600);

    await arrive(jashim);
    await startTrip(jashim);
    await complete(jashim, s.body.ride.id).expect(200);

    const { rows: w } = await pool.query('SELECT wallet_paisa FROM users WHERE id = $1', [shirin.id]);
    expect(w[0].wallet_paisa).toBe(50000 - 5600);
    const { rows: pay } = await pool.query('SELECT method, amount_paisa, status FROM payments WHERE ride_request_id = $1', [s.body.ride.id]);
    expect(pay).toEqual([{ method: 'TESLAPAY', amount_paisa: 5600, status: 'PAID' }]);
  });

  it('records cash payments without touching the wallet', async () => {
    await arrive(jashim);
    await startTrip(jashim);
    await complete(jashim, nusratRide);
    const { rows } = await pool.query('SELECT method, amount_paisa FROM payments');
    expect(rows).toEqual([{ method: 'CASH', amount_paisa: 5600 }]);
    const { rows: w } = await pool.query('SELECT wallet_paisa FROM users WHERE id = $1', [nusrat.id]);
    expect(w[0].wallet_paisa).toBe(50000);
  });

  it('lets a driver abandon the pool before the trip: passengers go back to waiting at the solo fare', async () => {
    const res = await cancelPool(jashim);
    expect(res.body).toEqual({ requeuedRides: 2 });

    const n = (await getRide(nusrat, nusratRide)).body.ride;
    expect(n).toMatchObject({ status: 'REQUESTED', pool: null, fare: { poolDiscountPaisa: 0, totalFarePaisa: 7000 } });
    expect((await getRide(rafiq, rafiqRide)).body.ride.fare.totalFarePaisa).toBe(8500);
    expect((await driverPool(jashim)).body.pool).toBeNull();
    const { rows } = await pool.query("SELECT status, occupied_seats FROM pools");
    expect(rows).toEqual([{ status: 'CANCELLED', occupied_seats: 0 }]);

    // A different Tesla can now take them.
    const ibrahim = await createDriver('Ibrahim', { name: 'Thunder', plate: 'DHAKA-METRO-THUNDER', capacity: 3 });
    await goOnline(ibrahim);
    await acceptRide(ibrahim, nusratRide).expect(200);
  });

  it('refuses to cancel a pool once the trip has started', async () => {
    await arrive(jashim);
    await startTrip(jashim);
    const res = await cancelPool(jashim);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('cannot cancel a completed ride', async () => {
    await arrive(jashim);
    await startTrip(jashim);
    await complete(jashim, nusratRide);
    const res = await cancelRide(nusrat, nusratRide);
    expect(res.status).toBe(409);
  });
});
