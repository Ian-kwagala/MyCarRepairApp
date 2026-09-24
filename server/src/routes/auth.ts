import { randomInt } from 'node:crypto';

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { normalizePhone } from '@/utils/format';

import { hashPassword, issueSession, revokeRefreshToken, rotateRefreshToken, sha256, verifyPassword } from '../auth';
import { config } from '../config';
import { one, pool, tx } from '../db';
import { ApiError, E } from '../errors';
import type { UserRow } from '../types';

export const authRouter = Router();

// Rate limit on auth (§13.1: login 5/min/IP).
const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: config.loginRateLimit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a minute and try again.' } });
  },
});

const role = z.enum(['owner', 'mechanic']);

const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(100),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(255),
  phone: z.string().trim().min(9, 'Enter a valid phone number.').max(20),
  password: z.string().min(6, 'Password must be at least 6 characters.').max(200),
  role,
  garageName: z.string().trim().max(100).optional(),
  garageLocation: z.string().trim().max(100).optional(),
  expertise: z.string().trim().max(2000).optional(),
});

/** POST /auth/register — owners are active; mechanics are pending until an admin approves them. */
authRouter.post('/register', loginLimiter, async (req, res) => {
  const b = registerSchema.parse(req.body);
  const phone = normalizePhone(b.phone);
  if (phone.replace(/\D/g, '').length < 9) throw E.validation('Enter a valid phone number.');
  if (b.role === 'mechanic' && (!b.garageName || !b.garageLocation)) throw E.validation('Enter your garage name and location.');
  const hash = await hashPassword(b.password);
  const session = await tx(async (db) => {
    const exists = await db.query(`SELECT 1 FROM users WHERE email = $1`, [b.email]);
    if (exists.rowCount) throw E.conflict('EMAIL_TAKEN', 'An account with this email already exists.');
    const user = (
      await db.query<UserRow>(
        `INSERT INTO users (full_name, email, password, phone, role, status, garage_name, garage_location, expertise)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          b.fullName,
          b.email,
          hash,
          phone,
          b.role,
          b.role === 'mechanic' ? 'pending' : 'active',
          b.role === 'mechanic' ? b.garageName || null : null,
          b.role === 'mechanic' ? b.garageLocation || null : null,
          b.role === 'mechanic' ? b.expertise || null : null,
        ],
      )
    ).rows[0];
    // Pending mechanics also get a session, restricted to /me (the app shows the verification screen, M7).
    return issueSession(db, user);
  });
  res.status(201).json(session);
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().optional(),
  phone: z.string().trim().optional(),
  password: z.string().min(1),
  role,
});

/** POST /auth/login {email|phone, password, role}. */
authRouter.post('/login', loginLimiter, async (req, res) => {
  const b = loginSchema.parse(req.body);
  const identifier = b.email ?? b.phone;
  if (!identifier) throw E.validation('Enter your phone or email.');
  const user = await one<UserRow>(
    `SELECT * FROM users WHERE role = $1 AND (lower(email) = lower($2) OR phone = $3) ORDER BY id LIMIT 1`,
    [b.role, identifier, normalizePhone(identifier)],
  );
  if (!user || !(await verifyPassword(b.password, user.password))) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email/phone or password.');
  }
  if (user.status === 'suspended') throw E.forbidden('Your account has been suspended. Contact support.');
  const client = await pool.connect();
  try {
    res.json(await issueSession(client, user));
  } finally {
    client.release();
  }
});

/** POST /auth/refresh {refreshToken} → rotated tokens. */
authRouter.post('/refresh', async (req, res) => {
  const { refreshToken } = z.object({ refreshToken: z.string().min(10) }).parse(req.body);
  const session = await tx((db) => rotateRefreshToken(db, refreshToken));
  res.json({ accessToken: session.accessToken, refreshToken: session.refreshToken });
});

/** POST /auth/logout {refreshToken?, pushToken?} — revokes the refresh token and the device push token. */
authRouter.post('/logout', async (req, res) => {
  const b = z.object({ refreshToken: z.string().optional(), pushToken: z.string().optional() }).parse(req.body ?? {});
  await revokeRefreshToken(b.refreshToken);
  if (b.pushToken) await pool.query(`DELETE FROM device_tokens WHERE token = $1`, [b.pushToken]);
  res.status(204).end();
});

/**
 * POST /auth/forgot-password {identifier} — creates a 6-digit one-time code (15 min, 5 attempts).
 * With no SMS provider configured yet (Africa's Talking is Phase 2), support reads the code from /admin
 * after verifying the caller, so the endpoint never reveals whether an account exists.
 */
authRouter.post('/forgot-password', loginLimiter, async (req, res) => {
  const { identifier } = z.object({ identifier: z.string().trim().min(3) }).parse(req.body);
  const user = await one<UserRow>(`SELECT * FROM users WHERE lower(email) = lower($1) OR phone = $2 ORDER BY id LIMIT 1`, [
    identifier,
    normalizePhone(identifier),
  ]);
  if (user) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await pool.query(
      `INSERT INTO password_resets (user_id, code_hash, code_hint, attempts, expires_at)
       VALUES ($1, $2, $3, 0, now() + interval '15 minutes')
       ON CONFLICT (user_id) DO UPDATE SET code_hash = $2, code_hint = $3, attempts = 0, expires_at = now() + interval '15 minutes'`,
      [user.id, sha256(`${user.id}:${code}`), code],
    );
  }
  // Same answer whether or not the account exists (no account enumeration).
  res.json({ verification: 'otp', channel: 'support' });
});

/** POST /auth/reset-password {identifier, code, password}. */
authRouter.post('/reset-password', loginLimiter, async (req, res) => {
  const b = z.object({ identifier: z.string().trim(), code: z.string().trim(), password: z.string().min(6, 'Password must be at least 6 characters.') }).parse(req.body);
  const user = await one<UserRow>(`SELECT * FROM users WHERE lower(email) = lower($1) OR phone = $2 ORDER BY id LIMIT 1`, [
    b.identifier,
    normalizePhone(b.identifier),
  ]);
  const invalid = E.validation('That code is not valid or has expired.');
  if (!user) throw invalid;
  await tx(async (db) => {
    const r = (
      await db.query<{ code_hash: string; attempts: number }>(
        `UPDATE password_resets SET attempts = attempts + 1 WHERE user_id = $1 AND expires_at > now() RETURNING code_hash, attempts`,
        [user.id],
      )
    ).rows[0];
    if (!r || r.attempts > 5 || r.code_hash !== sha256(`${user.id}:${b.code}`)) throw invalid;
    await db.query(`UPDATE users SET password = $1 WHERE id = $2`, [await hashPassword(b.password), user.id]);
    await db.query(`DELETE FROM password_resets WHERE user_id = $1`, [user.id]);
    await db.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [user.id]);
  }).catch(async (e) => {
    // Keep the attempt count even though the transaction rolled back.
    await pool.query(`UPDATE password_resets SET attempts = attempts + 1 WHERE user_id = $1`, [user.id]);
    throw e;
  });
  res.status(204).end();
});
