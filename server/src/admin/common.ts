// Helpers shared by the admin console's page modules (router.ts, shop.ts): sidebar counts, request parsing, safe
// redirects after form posts, and media links.
import type { Request } from 'express';

import { SOS_ISSUES } from '@/constants/config';

import { one } from '../db';
import type { NavCounts } from './ui';

/** SOS issue names, for SQL that recognises SOS jobs by their service type. */
export const SOS_LIST = [...SOS_ISSUES] as string[];
/** SQL condition (on alias j) for SOS jobs; takes SOS_LIST as $1. */
export const SOS_SQL = `(j.sos_active OR j.service_type = ANY($1::text[]))`;
/** Rows per page in admin lists. */
export const PAGE_SIZE = 50;

/** Sidebar badge counts and the maintenance flag, needed by every page. */
export async function chrome() {
  const r = (await one<NavCounts & { maintenance: string | null }>(
    `SELECT (SELECT COUNT(*) FROM users WHERE role = 'mechanic' AND status = 'pending')::int AS pending,
            (SELECT COUNT(*) FROM password_resets WHERE expires_at > now())::int AS resets,
            (SELECT COUNT(*) FROM jobs j WHERE j.status = 'pending' AND j.mechanic_id IS NULL AND ${SOS_SQL})::int AS "openSos",
            (SELECT COUNT(*) FROM orders WHERE status = 'placed')::int AS orders,
            (SELECT value FROM system_config WHERE key = 'maintenance_mode') AS maintenance`,
    [SOS_LIST],
  ))!;
  return { counts: { pending: r.pending, resets: r.resets, openSos: r.openSos, orders: r.orders }, maintenance: r.maintenance === 'true' };
}

/** A query/body value as a string ('' when missing or not a string). */
export const str = (v: unknown) => (typeof v === 'string' ? v : '');
/** `v` if it is one of `allowed`, else `fallback`. */
export const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
/** ILIKE pattern for a search term, with %, _ and \ escaped. */
export const like = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;
/** The ?page= number, clamped to 1…1000. */
export const pageNo = (req: Request) => Math.max(1, Math.min(1000, Number(req.query.page) || 1));
/** Same-origin URL for a stored "media/<key>" path, or null for anything else. */
export const mediaSrc = (path: string | null) => (path && /^media\/[A-Za-z0-9._-]+$/.test(path) ? `/${path}` : null);

/** Where to go after a POST: the page it came from (admin pages only), with a notice. */
export function backTo(req: Request, notice: string) {
  const raw = str(req.body?.back);
  const safe = raw.startsWith('/admin') && !raw.includes('//') && !raw.includes('\\') && raw.length < 500 ? raw : '/admin';
  const url = new URL(safe, 'http://local');
  url.searchParams.set('notice', notice);
  return `${url.pathname}${url.search}`;
}
