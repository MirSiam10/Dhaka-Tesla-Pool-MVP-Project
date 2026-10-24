import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  BCRYPT_COST: z.coerce.number().int().min(4).max(14).default(10),
  LOG_LEVEL: z.string().default('info'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  CORS_ORIGIN: z.string().optional(),
  // Load the demo cast (Jashim, Bullet, Nusrat, Rafiq, Shirin) on boot. Idempotent.
  SEED_ON_START: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  throw new Error(`Invalid environment configuration: ${problems}`);
}

export const config = parsed.data;
export type Config = typeof config;
