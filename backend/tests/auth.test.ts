import request from 'supertest';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool } from '../src/db/pool';
import { app, as, createDriver, PASSWORD, registerPassenger, resetData, setupDatabase } from './helpers';

describe('auth', () => {
  beforeAll(setupDatabase);
  beforeEach(resetData);
  afterAll(closePool);

  it('registers a passenger, returns a token and never exposes the password hash', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Nusrat', email: 'nusrat@example.com', password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ name: 'Nusrat', role: 'PASSENGER', walletPaisa: 50000 });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it('cannot self-register as a driver', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Jashim', email: 'jashim@example.com', password: PASSWORD, role: 'DRIVER' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('PASSENGER');
  });

  it('rejects a duplicate email case-insensitively', async () => {
    await registerPassenger('Rafiq', 'rafiq@example.com');
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Rafiq Two', email: 'RAFIQ@example.com', password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('validates input', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: '', email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['email', 'name', 'password']);
  });

  it('logs in with the right password and refuses the wrong one with the same message as an unknown email', async () => {
    await registerPassenger('Shirin', 'shirin@example.com');
    const ok = await request(app).post('/api/auth/login').send({ email: 'shirin@example.com', password: PASSWORD });
    expect(ok.status).toBe(200);
    const wrong = await request(app).post('/api/auth/login').send({ email: 'shirin@example.com', password: 'nope-nope-1' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@example.com', password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('protects /me and accepts a valid token', async () => {
    const nusrat = await registerPassenger('Nusrat');
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const me = await request(app).get('/api/auth/me').set(as(nusrat));
    expect(me.status).toBe(200);
    expect(me.body.user.name).toBe('Nusrat');
  });

  it('rejects tampered and expired tokens', async () => {
    const nusrat = await registerPassenger('Nusrat');
    const tampered = nusrat.token.slice(0, -3) + 'abc';
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tampered}`)).status).toBe(401);
    const expired = jwt.sign({ role: 'PASSENGER' }, process.env.JWT_SECRET!, { subject: nusrat.id, expiresIn: -10 });
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`)).status).toBe(401);
  });

  it('lets a seeded driver log in with the DRIVER role', async () => {
    const jashim = await createDriver();
    const me = await request(app).get('/api/auth/me').set(as(jashim));
    expect(me.body.user.role).toBe('DRIVER');
  });
});
