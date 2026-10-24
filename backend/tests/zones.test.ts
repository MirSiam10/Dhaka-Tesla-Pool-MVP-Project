import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool } from '../src/db/pool';
import { app, setupDatabase } from './helpers';

describe('zones and fare estimate', () => {
  beforeAll(setupDatabase);
  afterAll(closePool);

  it('lists the predefined zones with their corridors', async () => {
    const res = await request(app).get('/api/zones');
    expect(res.status).toBe(200);
    const banani = res.body.zones.find((z: { code: string }) => z.code === 'BANANI');
    expect(banani).toMatchObject({ name: 'Banani', corridor: 'EAST' });
  });

  it("estimates Nusrat's trip: solo 7000, shared 5600", async () => {
    const res = await request(app).get('/api/fare/estimate').query({ pickup: 'BANANI', destination: 'MOHAKHALI' });
    expect(res.status).toBe(200);
    expect(res.body.distanceM).toBe(2000);
    expect(res.body.solo.totalFarePaisa).toBe(7000);
    expect(res.body.shared.totalFarePaisa).toBe(5600);
  });

  it("estimates Rafiq's trip: solo 8500, shared 6800", async () => {
    const res = await request(app).get('/api/fare/estimate').query({ pickup: 'banani', destination: 'gulshan_1' });
    expect(res.status).toBe(200);
    expect(res.body.solo.totalFarePaisa).toBe(8500);
    expect(res.body.shared.totalFarePaisa).toBe(6800);
  });

  it('rejects unknown zones and identical pickup and destination', async () => {
    const unknown = await request(app).get('/api/fare/estimate').query({ pickup: 'BANANI', destination: 'ATLANTIS' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('UNKNOWN_ZONE');
    const same = await request(app).get('/api/fare/estimate').query({ pickup: 'BANANI', destination: 'BANANI' });
    expect(same.body.error.code).toBe('SAME_ZONE');
  });
});
