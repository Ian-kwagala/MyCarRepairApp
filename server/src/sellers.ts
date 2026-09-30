// Marketplace sellers: signed sessions for the /seller portal (an HttpOnly cookie, separate from the apps' tokens),
// the guard that loads the signed-in seller, and each seller's money: what is owed for delivered items, what is
// on its way in open orders, and what has been paid out.
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { RequestHandler, Response } from 'express';

import { config } from './config';
import { one, query, type Db } from './db';
import { sellerNet } from './shop';
import type { OrderItemRow, SellerRow } from './types';
import { privatePageHeaders, readCookie, sameOrigin } from './web';

/** Name of the seller portal's session cookie. */
export const SELLER_COOKIE = 'mcr_seller';
const SESSION_DAYS = 14;

// A separate key per purpose, derived from the server secret, so a seller cookie can never pass as anything else.
const sessionKey = () => createHmac('sha256', config.jwtSecret).update('seller-portal-session').digest();
const sign = (payload: string) => createHmac('sha256', sessionKey()).update(payload).digest('base64url');

/**
 * Session cookie value "<sellerId>.<sessionVersion>.<expiresAtMs>.<signature>". Bumping the seller's
 * session_version (suspension, password change) invalidates every cookie issued before.
 */
export function sellerSessionValue(seller: Pick<SellerRow, 'id' | 'session_version'>) {
  const payload = `${seller.id}.${seller.session_version}.${Date.now() + SESSION_DAYS * 86_400_000}`;
  return `${payload}.${sign(payload)}`;
}

/** Sets the session cookie: HttpOnly, SameSite=Lax, Secure in production, only sent to /seller pages. */
export function setSellerCookie(res: Response, seller: Pick<SellerRow, 'id' | 'session_version'>) {
  res.cookie(SELLER_COOKIE, sellerSessionValue(seller), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/seller',
    maxAge: SESSION_DAYS * 86_400_000,
  });
}

/** Removes the session cookie (sign out). */
export function clearSellerCookie(res: Response) {
  res.clearCookie(SELLER_COOKIE, { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/seller' });
}

/** The seller a cookie value belongs to, or null when it is missing, forged, expired or revoked. */
export async function sellerFromCookie(value: string | null): Promise<SellerRow | null> {
  const parts = value?.split('.') ?? [];
  if (parts.length !== 4) return null;
  const [id, version, expires, signature] = parts as [string, string, string, string];
  const expected = Buffer.from(sign(`${id}.${version}.${expires}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (!(Number(expires) > Date.now())) return null;
  const seller = await one<SellerRow>(`SELECT * FROM sellers WHERE id = $1`, [Number(id)]);
  if (!seller || seller.session_version !== Number(version) || seller.status === 'suspended') return null;
  return seller;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Signed-in marketplace seller (set by requireSeller on /seller pages). */
      seller?: SellerRow;
    }
  }
}

/**
 * Guard for the signed-in seller portal: a valid session cookie (otherwise off to the sign-in page), and form
 * posts only from our own pages (CSRF). Suspended sellers are signed out.
 */
export const requireSeller: RequestHandler = async (req, res, next) => {
  privatePageHeaders(res);
  const seller = await sellerFromCookie(readCookie(req, SELLER_COOKIE));
  if (!seller) {
    clearSellerCookie(res);
    res.redirect(303, '/seller/login');
    return;
  }
  if (req.method === 'POST' && !sameOrigin(req)) {
    res.status(403).send('Cross-site request blocked.');
    return;
  }
  req.seller = seller;
  next();
};

/** A seller's order line with the order's status (for earnings). */
export interface SellerLine extends OrderItemRow {
  order_status: string;
  order_created_at: Date;
}

/**
 * A seller's money. `owed`: delivered items not yet paid out. `coming`: items in confirmed orders that aren't
 * delivered yet. `paid`: everything paid out so far. Amounts are the seller's share after commission.
 */
export async function sellerBalances(db: Db, sellerId: number) {
  const lines = (
    await db.query<SellerLine>(
      `SELECT i.*, o.status AS order_status, o.created_at AS order_created_at FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE i.seller_id = $1 AND o.status <> 'cancelled'`,
      [sellerId],
    )
  ).rows;
  let owed = 0;
  let coming = 0;
  for (const l of lines) {
    if (l.order_status === 'delivered' && l.payout_id == null) owed += sellerNet(l).net;
    else if (l.order_status !== 'delivered' && l.order_status !== 'placed') coming += sellerNet(l).net;
  }
  const paid = Number((await db.query<{ total: string }>(`SELECT COALESCE(SUM(amount), 0) AS total FROM seller_payouts WHERE seller_id = $1`, [sellerId])).rows[0]!.total);
  return { owed, coming, paid };
}

/** Order lines a seller has to act on: in confirmed orders and not yet ready (the portal's badge). */
export async function linesToPrepare(sellerId: number): Promise<number> {
  const r = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.seller_id = $1 AND i.seller_status = 'new' AND o.status = 'confirmed'`,
    [sellerId],
  );
  return Number(r[0]?.n ?? 0);
}
