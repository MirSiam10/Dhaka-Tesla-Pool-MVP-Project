import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config';
import { query } from '../db/pool';
import { conflict, unauthorized } from '../errors';

export type Role = 'PASSENGER' | 'DRIVER';

export interface AuthUser {
  id: string;
  role: Role;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
  walletPaisa: number;
}

// Demo credit for the simulated TeslaPay wallet: 500.00 taka. There is no real gateway.
const SIGNUP_WALLET_PAISA = 50_000;

// Compared against when the email is unknown, so "no such user" and "wrong password"
// take the same time and cannot be told apart by timing.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 4);

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
  wallet_paisa: number;
  password_hash: string;
};

const toPublic = (r: UserRow): PublicUser => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role,
  phone: r.phone,
  walletPaisa: r.wallet_paisa,
});

export function signToken(user: AuthUser): string {
  return jwt.sign({ role: user.role }, config.JWT_SECRET, {
    subject: user.id,
    expiresIn: config.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): AuthUser {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as jwt.JwtPayload;
    if (!payload.sub || (payload.role !== 'PASSENGER' && payload.role !== 'DRIVER')) {
      throw new Error('bad claims');
    }
    return { id: payload.sub, role: payload.role };
  } catch {
    throw unauthorized('Invalid or expired token');
  }
}

/** Self-registration creates passengers only. Drivers are seeded (assumption A8). */
export async function registerPassenger(input: {
  name: string;
  email: string;
  password: string;
  phone?: string;
}): Promise<{ token: string; user: PublicUser }> {
  const hash = await bcrypt.hash(input.password, config.BCRYPT_COST);
  try {
    const { rows } = await query<UserRow>(
      `INSERT INTO users (name, email, phone, password_hash, role, wallet_paisa)
       VALUES ($1, $2, $3, $4, 'PASSENGER', $5)
       RETURNING *`,
      [input.name.trim(), input.email.trim(), input.phone ?? null, hash, SIGNUP_WALLET_PAISA],
    );
    const user = rows[0];
    return { token: signToken({ id: user.id, role: user.role }), user: toPublic(user) };
  } catch (err) {
    if ((err as { constraint?: string }).constraint === 'users_email_lower_uq') {
      throw conflict('EMAIL_TAKEN', 'That email is already registered.');
    }
    throw err;
  }
}

export async function login(email: string, password: string): Promise<{ token: string; user: PublicUser }> {
  const { rows } = await query<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [email.trim()]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Incorrect email or password');
  return { token: signToken({ id: user.id, role: user.role }), user: toPublic(user) };
}

export async function getUser(id: string): Promise<PublicUser> {
  const { rows } = await query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  if (!rows[0]) throw unauthorized('Account no longer exists');
  return toPublic(rows[0]);
}
