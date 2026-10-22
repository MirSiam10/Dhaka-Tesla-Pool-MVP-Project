import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, pool } from '../src/db/pool';
import { app, as, createDriver, registerPassenger, resetData, setupDatabase } from './helpers';

const bananiToMohakhali = { pickupZone: 'BANANI', destinationZone: 'MOHAKHALI' };

describe('passenger rides', () => {
  beforeAll(setupDatabase);
  beforeEach(resetData);
  afterAll(closePool);

  it("creates Nusrat's ride as REQUESTED with the solo fare and a shared-fare hint", async () => {
    const nusrat = await registerPassenger('Nusrat');
    const res = await request(app).post('/api/rides').set(as(nusrat)).send(bananiToMohakhali);
    expect(res.status).toBe(201);
    expect(res.body.ride).toMatchObject({
      status: 'REQUESTED',
      seats: 1,
      paymentMethod: 'CASH',
      pickup: { code: 'BANANI', name: 'Banani' },
      destination: { code: 'MOHAKHALI', name: 'Mohakhali' },
      distanceM: 2000,
      pool: null,
      fare: { baseFarePaisa: 4000, distanceChargePaisa: 3000, poolDiscountPaisa: 0, totalFarePaisa: 7000, ifSharedTotalPaisa: 5600 },
    });
  });

  it('requires authentication and the passenger role', async () => {
    expect((await request(app).post('/api/rides').send(bananiToMohakhali)).status).toBe(401);
    const jashim = await createDriver();
    const res = await request(app).post('/api/rides').set(as(jashim)).send(bananiToMohakhali);
    expect(res.status).toBe(403);
  });

  it('validates the request body', async () => {
    const nusrat = await registerPassenger('Nusrat');
    const post = (body: object) => request(app).post('/api/rides').set(as(nusrat)).send(body);
    expect((await post({ pickupZone: 'BANANI', destinationZone: 'BANANI' })).body.error.code).toBe('SAME_ZONE');
    expect((await post({ pickupZone: 'BANANI', destinationZone: 'ATLANTIS' })).body.error.code).toBe('UNKNOWN_ZONE');
    expect((await post({ ...bananiToMohakhali, seats: 0 })).body.error.code).toBe('VALIDATION_ERROR');
    expect((await post({ ...bananiToMohakhali, seats: 4 })).body.error.code).toBe('VALIDATION_ERROR');
    expect((await post({ ...bananiToMohakhali, paymentMethod: 'BITCOIN' })).body.error.code).toBe('VALIDATION_ERROR');
  });

  it('allows only one active ride per passenger', async () => {
    const nusrat = await registerPassenger('Nusrat');
    await request(app).post('/api/rides').set(as(nusrat)).send(bananiToMohakhali).expect(201);
    const again = await request(app).post('/api/rides').set(as(nusrat)).send(bananiToMohakhali);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ACTIVE_RIDE_EXISTS');
  });

  it('refuses a TeslaPay ride the wallet cannot cover', async () => {
    const nusrat = await registerPassenger('Nusrat');
    await pool.query('UPDATE users SET wallet_paisa = 6999 WHERE id = $1', [nusrat.id]);
    const res = await request(app)
      .post('/api/rides')
      .set(as(nusrat))
      .send({ ...bananiToMohakhali, paymentMethod: 'TESLAPAY' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_WALLET', details: { requiredPaisa: 7000, balancePaisa: 6999 } });
  });

  it("shows a passenger only their own rides, and treats someone else's ride as not found", async () => {
    const nusrat = await registerPassenger('Nusrat');
    const rafiq = await registerPassenger('Rafiq');
    const mine = await request(app).post('/api/rides').set(as(nusrat)).send(bananiToMohakhali);
    await request(app).post('/api/rides').set(as(rafiq)).send({ pickupZone: 'BANANI', destinationZone: 'GULSHAN_1' });

    const list = await request(app).get('/api/rides').set(as(nusrat));
    expect(list.body.rides).toHaveLength(1);
    expect(list.body.rides[0].id).toBe(mine.body.ride.id);

    const id = mine.body.ride.id;
    expect((await request(app).get(`/api/rides/${id}`).set(as(rafiq))).status).toBe(404);
    expect((await request(app).get(`/api/rides/${id}/events`).set(as(rafiq))).status).toBe(404);
    expect((await request(app).post(`/api/rides/${id}/cancel`).set(as(rafiq))).status).toBe(404);
    // ...and the ride is untouched
    expect((await request(app).get(`/api/rides/${id}`).set(as(nusrat))).body.ride.status).toBe('REQUESTED');
  });

  it('cancels a waiting ride once, then rejects a second cancel and frees the passenger to book again', async () => {
    const nusrat = await registerPassenger('Nusrat');
    const created = await request(app).post('/api/rides').set(as(nusrat)).send(bananiToMohakhali);
    const id = created.body.ride.id;

    const cancelled = await request(app).post(`/api/rides/${id}/cancel`).set(as(nusrat));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.ride.status).toBe('CANCELLED');
    expect(cancelled.body.ride.timestamps.cancelledAt).toEqual(expect.any(String));

    const second = await request(app).post(`/api/rides/${id}/cancel`).set(as(nusrat));
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('INVALID_TRANSITION');

    await request(app).post('/api/rides').set(as(nusrat)).send(bananiToMohakhali).expect(201);
  });

  it('keeps an append-only history that explains what happened', async () => {
    const nusrat = await registerPassenger('Nusrat');
    const created = await request(app).post('/api/rides').set(as(nusrat)).send(bananiToMohakhali);
    const id = created.body.ride.id;
    await request(app).post(`/api/rides/${id}/cancel`).set(as(nusrat));

    const res = await request(app).get(`/api/rides/${id}/events`).set(as(nusrat));
    expect(res.body.events.map((e: { type: string }) => e.type)).toEqual(['RIDE_REQUESTED', 'RIDE_CANCELLED']);
    expect(res.body.events[1]).toMatchObject({ from: 'REQUESTED', to: 'CANCELLED' });
  });

  it('rejects a malformed ride id', async () => {
    const nusrat = await registerPassenger('Nusrat');
    const res = await request(app).get('/api/rides/not-a-uuid').set(as(nusrat));
    expect(res.status).toBe(400);
  });
});
