import { Router } from 'express';
import { z } from 'zod';

import { DEFAULT_CONFIG } from '@/constants/config';
import { normalizePhone } from '@/utils/format';

import { me, requireAuth } from '../auth';
import { pool, query } from '../db';
import { toUser } from '../mappers';
import { emitTo } from '../realtime';
import type { UserRow } from '../types';

export const meRouter = Router();

/** GET /config (public) — fee, lists, maintenance flag, min app version (§6 task 10). */
meRouter.get('/config', async (_req, res) => {
  const rows = await query<{ key: string; value: string }>(`SELECT key, value FROM system_config`);
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  res.json({
    ...DEFAULT_CONFIG,
    serviceFee: get('service_fee') ? Number(get('service_fee')) : DEFAULT_CONFIG.serviceFee,
    maintenance: get('maintenance_mode') === 'true',
    minAppVersion: get('min_app_version') ?? DEFAULT_CONFIG.minAppVersion,
    supportPhone: get('support_phone') ?? DEFAULT_CONFIG.supportPhone,
  });
});

meRouter.get('/me', requireAuth, (req, res) => {
  res.json(toUser(me(req)));
});

const patchSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(100).optional(),
  phone: z.string().trim().min(9).max(20).optional(),
  garageName: z.string().trim().max(100).nullable().optional(),
  garageLocation: z.string().trim().max(100).nullable().optional(),
  expertise: z.string().trim().max(2000).nullable().optional(),
});

meRouter.patch('/me', requireAuth, async (req, res) => {
  const u = me(req);
  const b = patchSchema.parse(req.body);
  const mech = u.role === 'mechanic';
  const row = (
    await query<UserRow>(
      `UPDATE users SET
         full_name = COALESCE($2, full_name),
         phone = COALESCE($3, phone),
         garage_name = CASE WHEN $7 AND $4::text IS NOT NULL THEN NULLIF($4, '') ELSE garage_name END,
         garage_location = CASE WHEN $7 AND $5::text IS NOT NULL THEN NULLIF($5, '') ELSE garage_location END,
         expertise = CASE WHEN $7 AND $6::text IS NOT NULL THEN NULLIF($6, '') ELSE expertise END
       WHERE id = $1 RETURNING *`,
      [u.id, b.fullName ?? null, b.phone ? normalizePhone(b.phone) : null, b.garageName ?? null, b.garageLocation ?? null, b.expertise ?? null, mech],
    )
  )[0];
  res.json(toUser(row));
});

/** POST /me/location {lat, lng, accuracy?} — relayed to the active job room while en route (§6.2). */
meRouter.post('/me/location', requireAuth, async (req, res) => {
  const u = me(req);
  const b = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().nullable().optional() }).parse(req.body);
  await pool.query(`UPDATE users SET location_lat = $2, location_lng = $3 WHERE id = $1`, [u.id, b.lat, b.lng]);
  if (u.role === 'mechanic') {
    const live = await query<{ id: number; owner_id: number }>(
      `SELECT id, owner_id FROM jobs WHERE mechanic_id = $1 AND status IN ('accepted', 'diagnosing', 'fixing', 'ready')`,
      [u.id],
    );
    for (const j of live) emitTo([j.owner_id], 'mechanic_location', { jobId: j.id, lat: b.lat, lng: b.lng });
  }
  res.status(204).end();
});

/** POST /me/push-token {token, platform} (§5.3). */
meRouter.post('/me/push-token', requireAuth, async (req, res) => {
  const b = z.object({ token: z.string().min(10).max(300), platform: z.string().max(10).optional() }).parse(req.body);
  await pool.query(
    `INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET user_id = $1, platform = $3`,
    [me(req).id, b.token, b.platform ?? null],
  );
  res.status(204).end();
});
