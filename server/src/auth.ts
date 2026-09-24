import { createHash, randomBytes } from 'node:crypto';

import bcrypt from 'bcryptjs';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';

import { config } from './config';
import { one, query, type Db } from './db';
import { E } from './errors';
import { toUser } from './mappers';
import type { UserRow } from './types';

export const hashPassword = (password: string) => bcrypt.hash(password, 10);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function signAccessToken(user: Pick<UserRow, 'id' | 'role'>): string {
  return jwt.sign({ sub: String(user.id), role: user.role }, config.jwtSecret, {
    expiresIn: config.accessTokenTtl as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): number {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    const id = Number(payload.sub);
    if (!Number.isInteger(id)) throw new Error('bad sub');
    return id;
  } catch {
    throw E.unauthorized();
  }
}

/** Issues an access token (24 h) and a rotating refresh token (30 d, stored hashed) — §6.1. */
export async function issueSession(db: Db, user: UserRow) {
  const refreshToken = randomBytes(48).toString('base64url');
  await db.query(
    `INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [sha256(refreshToken), user.id, String(config.refreshTokenDays)],
  );
  return { user: toUser(user), accessToken: signAccessToken(user), refreshToken };
}

export async function rotateRefreshToken(db: Db, refreshToken: string) {
  const row = (
    await db.query<{ user_id: number }>(
      `DELETE FROM refresh_tokens WHERE token_hash = $1 AND expires_at > now() RETURNING user_id`,
      [sha256(refreshToken)],
    )
  ).rows[0];
  if (!row) throw E.unauthorized('Your session expired. Please sign in again.');
  const user = (await db.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [row.user_id])).rows[0];
  // Refresh is rejected for suspended users (§6.1).
  if (!user || user.status === 'suspended') throw E.unauthorized('Your account is not active. Contact support.');
  return issueSession(db, user);
}

export async function revokeRefreshToken(refreshToken: string | undefined) {
  if (refreshToken) await query(`DELETE FROM refresh_tokens WHERE token_hash = $1`, [sha256(refreshToken)]);
}

export async function loadUser(id: number) {
  return one<UserRow>(`SELECT * FROM users WHERE id = $1`, [id]);
}

/** Bearer auth on every protected route; the user row is reloaded so suspensions apply immediately. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw E.unauthorized();
  const user = await loadUser(verifyAccessToken(token));
  if (!user) throw E.unauthorized();
  if (user.status === 'suspended') throw E.forbidden('Your account has been suspended. Contact support.');
  req.user = user;
  next();
};

/** Role guard. Pending mechanics may only reach the routes that opt in with allowPending. */
export function requireRole(role: 'owner' | 'mechanic', opts: { allowPending?: boolean } = {}): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const u = req.user!;
    if (u.role !== role) throw E.forbidden();
    if (u.status !== 'active' && !opts.allowPending) throw E.forbidden('Your account is still under review.');
    next();
  };
}

export function me(req: Request): UserRow {
  if (!req.user) throw E.unauthorized();
  return req.user;
}
