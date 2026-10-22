import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, pool } from '../src/db/pool';
import { DEMO_PASSWORD, runSeed } from '../src/db/seed';
import { app, goOnline, resetData, setupDatabase } from './helpers';

describe('seed data', () => {
  beforeAll(setupDatabase);
  beforeEach(resetData);
  afterAll(closePool);

  it('creates the Banani cast and is safe to run twice', async () => {
    await runSeed();
    await runSeed();
    const users = await pool.query('SELECT name, role FROM users ORDER BY name');
    expect(users.rows).toEqual([
      { name: 'Jashim', role: 'DRIVER' },
      { name: 'Nusrat', role: 'PASSENGER' },
      { name: 'Rafiq', role: 'PASSENGER' },
      { name: 'Shirin', role: 'PASSENGER' },
    ]);
    const v = await pool.query('SELECT name, capacity FROM vehicles');
    expect(v.rows).toEqual([{ name: 'Bullet', capacity: 3 }]);
  });

  it('lets every seeded user sign in with the documented demo password', async () => {
    await runSeed();
    for (const email of ['jashim', 'nusrat', 'rafiq', 'shirin']) {
      const res = await request(app).post('/api/auth/login').send({ email: `${email}@example.com`, password: DEMO_PASSWORD });
      expect(res.status).toBe(200);
    }
    const login = await request(app).post('/api/auth/login').send({ email: 'jashim@example.com', password: DEMO_PASSWORD });
    expect((await goOnline({ token: login.body.token } as never)).status).toBe(200);
  });
});
