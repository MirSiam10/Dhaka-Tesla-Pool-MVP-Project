import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { authenticate, currentUser } from '../middleware/auth';
import * as auth from '../services/auth';

export const authRouter = Router();

// Brute-force protection for credential endpoints. Off in tests, which hammer them on purpose.
const limiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.NODE_ENV === 'test',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again in a minute' } },
});

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().max(254).pipe(z.email()),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
  phone: z.string().trim().min(6).max(20).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().max(254),
  password: z.string().min(1).max(72),
});

authRouter.post('/register', limiter, async (req, res) => {
  const input = registerSchema.parse(req.body);
  res.status(201).json(await auth.registerPassenger(input));
});

authRouter.post('/login', limiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  res.json(await auth.login(email, password));
});

authRouter.get('/me', authenticate, async (req, res) => {
  res.json({ user: await auth.getUser(currentUser(req).id) });
});
