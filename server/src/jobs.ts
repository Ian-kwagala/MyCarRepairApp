import type { Job } from '@/models';
import { DEFAULT_CONFIG, DISPATCH } from '@/constants/config';
import { distanceKm } from '@/utils/geo';
import { computeTotals } from '@/utils/jobs';

import { one, type Db } from './db';
import { toChecklistItem, toJob, toQuote, toReview, toVehicle } from './mappers';
import type { ChecklistRow, JobRow, QuoteRow, ReviewRow, UserRow, VehicleRow } from './types';

export async function serviceFee(db?: Db): Promise<number> {
  const q = db ? (await db.query<{ value: string }>(`SELECT value FROM system_config WHERE key = 'service_fee'`)).rows[0] : await one<{ value: string }>(`SELECT value FROM system_config WHERE key = 'service_fee'`);
  return q ? Number(q.value) : DEFAULT_CONFIG.serviceFee;
}

export async function mechanicRating(db: Db, mechanicId: number): Promise<number> {
  const r = (await db.query<{ avg: number | null }>(`SELECT AVG(rating)::numeric(3,1) AS avg FROM reviews WHERE mechanic_id = $1`, [mechanicId])).rows[0];
  return r?.avg ? Number(r.avg) : 0;
}

const hasLocation = (u: Pick<UserRow, 'location_lat' | 'location_lng'>) => u.location_lat != null && u.location_lng != null;

/**
 * Full job for one viewer (GET /jobs/:id shape): vehicle, mechanic, owner, checklist, quotes, totals, review.
 * Phone numbers and exact locations go only to the counter-party of an accepted, live job (§13.1).
 */
export async function expandJob(db: Db, base: string, row: JobRow, viewer: UserRow, opts: { withDistance?: boolean } = {}): Promise<Job> {
  const job = toJob(row);
  const live = row.mechanic_id != null && !['completed', 'cancelled'].includes(row.status);
  const isCounterparty = viewer.id === row.owner_id || viewer.id === row.mechanic_id;

  const [vehicle, mech, owner, checklist, quotes, review, extra, fee] = await Promise.all([
    row.vehicle_id ? db.query<VehicleRow>(`SELECT * FROM vehicles WHERE id = $1`, [row.vehicle_id]).then((r) => r.rows[0]) : undefined,
    row.mechanic_id ? db.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [row.mechanic_id]).then((r) => r.rows[0]) : undefined,
    db.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [row.owner_id]).then((r) => r.rows[0]),
    db.query<ChecklistRow>(`SELECT * FROM job_checklists WHERE job_id = $1 ORDER BY id`, [row.id]).then((r) => r.rows),
    db.query<QuoteRow>(`SELECT * FROM parts_quotes WHERE job_id = $1 ORDER BY id`, [row.id]).then((r) => r.rows),
    db.query<ReviewRow>(`SELECT * FROM reviews WHERE job_id = $1`, [row.id]).then((r) => r.rows[0]),
    db.query<{ scheduled_date: string | null; notes: string | null }>(`SELECT scheduled_date, notes FROM job_extras WHERE job_id = $1`, [row.id]).then((r) => r.rows[0]),
    serviceFee(db),
  ]);

  if (vehicle) job.vehicle = toVehicle(base, vehicle);
  if (mech) {
    job.mechanic = {
      id: mech.id,
      fullName: mech.full_name,
      phone: isCounterparty ? mech.phone : null,
      garageName: mech.garage_name,
      rating: await mechanicRating(db, mech.id),
      locationLat: live && isCounterparty ? mech.location_lat : null,
      locationLng: live && isCounterparty ? mech.location_lng : null,
    };
  }
  if (owner) {
    const reveal = viewer.id === row.owner_id || (viewer.id === row.mechanic_id && live);
    job.owner = {
      id: owner.id,
      fullName: owner.full_name,
      phone: reveal ? owner.phone : null,
      locationLat: reveal ? owner.location_lat : null,
      locationLng: reveal ? owner.location_lng : null,
    };
    if (opts.withDistance) {
      job.distanceKm =
        hasLocation(viewer) && hasLocation(owner)
          ? Math.round(distanceKm(viewer.location_lat!, viewer.location_lng!, owner.location_lat!, owner.location_lng!) * 10) / 10
          : null;
    }
  }
  job.checklist = checklist.map((c) => toChecklistItem(base, c));
  job.quotes = quotes.map((q) => toQuote(base, q));
  job.totals = computeTotals(job.quotes, fee);
  if (row.status === 'completed' && row.total_price) job.totals.total = Number(row.total_price);
  job.review = review ? toReview(review) : null;
  job.scheduledDate = extra?.scheduled_date ?? null;
  job.notes = extra?.notes ?? null;
  return job;
}

export function expandAll(db: Db, base: string, rows: JobRow[], viewer: UserRow, opts?: { withDistance?: boolean }) {
  return Promise.all(rows.map((r) => expandJob(db, base, r, viewer, opts)));
}

/** FR-03 (§6.3): nearest 5 online, active mechanics within the radius — existing columns only. */
export async function nearestMechanics(db: Db, lat: number, lng: number, radiusKm: number) {
  return (
    await db.query<{ id: number; dist_km: number }>(
      `SELECT id, dist_km FROM (
         SELECT id,
                6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(location_lat - $1) / 2), 2) +
                  COS(RADIANS($1)) * COS(RADIANS(location_lat)) *
                  POWER(SIN(RADIANS(location_lng - $2) / 2), 2))) AS dist_km
         FROM users
         WHERE role = 'mechanic' AND status = 'active' AND is_online AND location_lat IS NOT NULL
       ) m WHERE dist_km <= $3 ORDER BY dist_km LIMIT $4`,
      [lat, lng, radiusKm, DISPATCH.limit],
    )
  ).rows.map((r) => ({ id: r.id, km: Number(r.dist_km) }));
}

/** Radius for an open SOS: 10 km, widened to 20 km after 60 s without acceptance (§6 task 5). */
export function sosRadius(job: Pick<JobRow, 'created_at'>) {
  return Date.now() - job.created_at.getTime() > DISPATCH.widenAfterMs ? DISPATCH.widenedRadiusKm : DISPATCH.radiusKm;
}

/** Mechanics who should currently see an open SOS (nearest 5 to the owner within the radius). */
export async function sosTargets(db: Db, job: JobRow) {
  const owner = (await db.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [job.owner_id])).rows[0];
  if (!owner || !hasLocation(owner)) return [];
  return nearestMechanics(db, owner.location_lat!, owner.location_lng!, sosRadius(job));
}

export async function onlineMechanicIds(db: Db): Promise<number[]> {
  return (await db.query<{ id: number }>(`SELECT id FROM users WHERE role = 'mechanic' AND status = 'active' AND is_online`)).rows.map((r) => r.id);
}

export async function jobSummary(db: Db, job: JobRow): Promise<string> {
  const r = (
    await db.query<{ full_name: string; make: string | null; model: string | null }>(
      `SELECT u.full_name, v.make, v.model FROM users u LEFT JOIN vehicles v ON v.id = $2 WHERE u.id = $1`,
      [job.owner_id, job.vehicle_id],
    )
  ).rows[0];
  return `${r?.full_name ?? 'Owner'} · ${r?.make ? `${r.make} ${r.model}` : 'Vehicle'}`;
}

