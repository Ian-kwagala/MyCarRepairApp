import { Router } from 'express';
import { z } from 'zod';

import { ARRIVAL_CHECKLIST, MAX_PHOTOS } from '@/constants/config';
import { firstName, formatUGX } from '@/utils/format';
import { etaMinutes, distanceKm } from '@/utils/geo';
import { computeTotals } from '@/utils/jobs';

import { me, requireAuth, requireRole } from '../auth';
import { pool, query, tx, type Db } from '../db';
import { E } from '../errors';
import { expandAll, expandJob, mechanicRating, onlineMechanicIds, serviceFee, sosTargets } from '../jobs';
import { toChecklistItem, toQuote, toReview, toUser } from '../mappers';
import { baseUrl, filesOf, storeFiles, upload } from '../media';
import { emitTo } from '../realtime';
import type { ChecklistRow, JobRow, QuoteRow, ReviewRow, UserRow } from '../types';

export const mechanicRouter = Router();
mechanicRouter.use(requireAuth);

const ACTIVE = `('pending', 'accepted', 'diagnosing', 'fixing', 'ready')`;

async function assignedJob(db: Db, mech: UserRow, jobId: number, lock = false) {
  const job = (await db.query<JobRow>(`SELECT * FROM jobs WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [jobId])).rows[0];
  if (!job) throw E.notFound('Job');
  if (job.mechanic_id !== mech.id) throw E.forbidden('This job is assigned to another mechanic.');
  return job;
}

/** PATCH /mechanic/status {isOnline} — duty toggle; joins/leaves dispatch. */
mechanicRouter.patch('/status', requireRole('mechanic'), async (req, res) => {
  const { isOnline } = z.object({ isOnline: z.boolean() }).parse(req.body);
  const row = (await query<UserRow>(`UPDATE users SET is_online = $2 WHERE id = $1 RETURNING *`, [me(req).id, isOnline]))[0];
  res.json(toUser(row));
});

/** GET /mechanic/jobs?tab=sos|bookings|active|history&lat&lng — Job[] with distanceKm. */
mechanicRouter.get('/jobs', requireRole('mechanic'), async (req, res) => {
  let u = me(req);
  const tab = z.enum(['sos', 'bookings', 'active', 'history']).parse(req.query.tab ?? 'sos');
  const lat = req.query.lat !== undefined ? Number(req.query.lat) : NaN;
  const lng = req.query.lng !== undefined ? Number(req.query.lng) : NaN;
  if (Number.isFinite(lat) && Number.isFinite(lng)) u = { ...u, location_lat: lat, location_lng: lng };
  let rows: JobRow[] = [];
  if (tab === 'sos') {
    if (!u.is_online) {
      res.json([]);
      return;
    }
    const open = await query<JobRow>(`SELECT * FROM jobs WHERE sos_active AND status = 'pending' AND mechanic_id IS NULL ORDER BY created_at`);
    for (const j of open) if ((await sosTargets(pool, j)).some((t) => t.id === u.id)) rows.push(j);
  } else if (tab === 'bookings') {
    rows = await query<JobRow>(`SELECT * FROM jobs WHERE NOT sos_active AND status = 'pending' AND mechanic_id IS NULL ORDER BY created_at LIMIT 50`);
  } else if (tab === 'active') {
    rows = await query<JobRow>(`SELECT * FROM jobs WHERE mechanic_id = $1 AND status IN ${ACTIVE} ORDER BY updated_at DESC`, [u.id]);
  } else {
    rows = await query<JobRow>(`SELECT * FROM jobs WHERE mechanic_id = $1 AND status NOT IN ${ACTIVE} ORDER BY updated_at DESC LIMIT 50`, [u.id]);
  }
  const jobs = await expandAll(pool, baseUrl(req), rows, u, { withDistance: true });
  if (tab === 'sos') jobs.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  res.json(jobs);
});

/** GET /mechanic/stats — {totalJobs, activeJobs, rating}. */
mechanicRouter.get('/stats', requireRole('mechanic', { allowPending: true }), async (req, res) => {
  const u = me(req);
  const r = (
    await query<{ total: string; active: string }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'completed') AS total, COUNT(*) FILTER (WHERE status IN ${ACTIVE}) AS active FROM jobs WHERE mechanic_id = $1`,
      [u.id],
    )
  )[0];
  res.json({ totalJobs: Number(r.total), activeJobs: Number(r.active), rating: await mechanicRating(pool, u.id) });
});

/** POST /mechanic/jobs/:id/accept — atomic first-come claim; 409 if taken (§6.2). */
mechanicRouter.post('/jobs/:id/accept', requireRole('mechanic'), async (req, res) => {
  const u = me(req);
  const jobId = Number(req.params.id);
  const out = await tx(async (db) => {
    // UPDATE … WHERE mechanic_id IS NULL: only one mechanic can win.
    const row = (
      await db.query<JobRow>(
        `UPDATE jobs SET mechanic_id = $1, status = 'accepted', updated_at = now()
         WHERE id = $2 AND mechanic_id IS NULL AND status = 'pending' RETURNING *`,
        [u.id, jobId],
      )
    ).rows[0];
    if (!row) {
      const j = (await db.query<JobRow>(`SELECT * FROM jobs WHERE id = $1`, [jobId])).rows[0];
      if (!j) throw E.notFound('Job');
      if (j.status === 'cancelled') throw E.conflict('JOB_CANCELLED', 'The owner cancelled this request.');
      throw E.conflict('JOB_ALREADY_TAKEN', 'Another mechanic accepted this job.');
    }
    const owner = (await db.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [row.owner_id])).rows[0];
    const km =
      u.location_lat != null && owner?.location_lat != null ? distanceKm(u.location_lat, u.location_lng!, owner.location_lat, owner.location_lng!) : null;
    return {
      row,
      job: await expandJob(db, baseUrl(req), row, u),
      others: (await onlineMechanicIds(db)).filter((id) => id !== u.id),
      summary: row.sos_active
        ? `${u.full_name} is on the way${km != null ? ` · ${etaMinutes(km)} min` : ''}`
        : `Booking accepted by ${u.garage_name || u.full_name}`,
    };
  });
  emitTo([out.row.owner_id], out.row.sos_active ? 'job_taken' : 'appointment_update', { jobId, summary: out.summary });
  emitTo(out.others, 'job_unavailable', { jobId });
  res.json(out.job);
});

/** POST /mechanic/jobs/:id/decline — a booking → cancelled (web parity); an SOS is only skipped. */
mechanicRouter.post('/jobs/:id/decline', requireRole('mechanic'), async (req, res) => {
  const u = me(req);
  const jobId = Number(req.params.id);
  const out = await tx(async (db) => {
    const row = (await db.query<JobRow>(`SELECT * FROM jobs WHERE id = $1 FOR UPDATE`, [jobId])).rows[0];
    if (!row) throw E.notFound('Job');
    if (row.sos_active) return null;
    if (row.status !== 'pending' || row.mechanic_id != null) throw E.conflict('JOB_ALREADY_TAKEN', 'This booking is no longer open.');
    await db.query(`UPDATE jobs SET status = 'cancelled', updated_at = now() WHERE id = $1`, [jobId]);
    return { ownerId: row.owner_id, others: (await onlineMechanicIds(db)).filter((id) => id !== u.id), summary: `${row.service_type} booking was declined — please book again` };
  });
  if (out) {
    emitTo([out.ownerId], 'appointment_update', { jobId, summary: out.summary });
    emitTo(out.others, 'job_unavailable', { jobId });
  }
  res.status(204).end();
});

/** POST /mechanic/jobs/:id/arrived — status fixing; the arrival checklist is activated. */
mechanicRouter.post('/jobs/:id/arrived', requireRole('mechanic'), async (req, res) => {
  const u = me(req);
  const out = await tx(async (db) => {
    const row = await assignedJob(db, u, Number(req.params.id), true);
    if (row.status !== 'accepted') throw E.conflict('INVALID_STATE', 'You have already marked arrival.');
    const updated = (await db.query<JobRow>(`UPDATE jobs SET status = 'fixing', updated_at = now() WHERE id = $1 RETURNING *`, [row.id])).rows[0];
    const has = await db.query(`SELECT 1 FROM job_checklists WHERE job_id = $1 LIMIT 1`, [row.id]);
    if (!has.rowCount) {
      for (const t of ARRIVAL_CHECKLIST) await db.query(`INSERT INTO job_checklists (job_id, task_description) VALUES ($1, $2)`, [row.id, t]);
    }
    return { job: await expandJob(db, baseUrl(req), updated, u), ownerId: row.owner_id };
  });
  emitTo([out.ownerId], 'job_progress_update', { jobId: out.job.id, summary: `${firstName(u.full_name)} reached your car` });
  res.json(out.job);
});

/** PATCH /mechanic/tasks/:taskId (multipart {isCompleted, photo?}) — photo proof in job_checklists.photo_url (FR15). */
mechanicRouter.patch('/tasks/:taskId', requireRole('mechanic'), upload.fields([{ name: 'photo', maxCount: 1 }]), async (req, res) => {
  const u = me(req);
  const isCompleted = z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .parse(req.body?.isCompleted);
  const out = await tx(async (db) => {
    const task = (await db.query<ChecklistRow>(`SELECT * FROM job_checklists WHERE id = $1 FOR UPDATE`, [Number(req.params.taskId)])).rows[0];
    if (!task) throw E.notFound('Task');
    const job = await assignedJob(db, u, task.job_id);
    if (job.status !== 'fixing') throw E.unprocessable('INVALID_STATE', 'Mark "Reached car" before ticking tasks.');
    const [photo] = await storeFiles(db, u.id, filesOf(req, 'photo'));
    const updated = (
      await db.query<ChecklistRow>(
        `UPDATE job_checklists SET is_completed = $2, completed_at = CASE WHEN $2 THEN now() ELSE NULL END, photo_url = COALESCE($3, photo_url)
         WHERE id = $1 RETURNING *`,
        [task.id, isCompleted, photo ?? null],
      )
    ).rows[0];
    await db.query(`UPDATE jobs SET updated_at = now() WHERE id = $1`, [job.id]);
    const counts = (
      await db.query<{ done: string; total: string }>(`SELECT COUNT(*) FILTER (WHERE is_completed) AS done, COUNT(*) AS total FROM job_checklists WHERE job_id = $1`, [job.id])
    ).rows[0];
    return { updated, job, pct: Math.round((Number(counts.done) / Math.max(1, Number(counts.total))) * 100) };
  });
  // In-app only (§8): the owner's tracker updates live.
  emitTo([out.job.owner_id], 'task_update', { jobId: out.job.id, taskId: out.updated.id, summary: `${out.updated.task_description} · ${out.pct}%` });
  res.json(toChecklistItem(baseUrl(req), out.updated));
});

/** POST /mechanic/jobs/:id/quotes (multipart {partName, price, photos[≤5]}) — is_approved NULL until the owner decides. */
mechanicRouter.post('/jobs/:id/quotes', requireRole('mechanic'), upload.array('photos', MAX_PHOTOS), async (req, res) => {
  const u = me(req);
  const b = z
    .object({ partName: z.string().trim().min(2, 'Enter the part name.').max(100), price: z.coerce.number().positive('Enter the price in UGX.').max(1e10) })
    .parse(req.body);
  const out = await tx(async (db) => {
    const job = await assignedJob(db, u, Number(req.params.id));
    if (job.status !== 'fixing') throw E.unprocessable('INVALID_STATE', 'You can quote parts after reaching the car.');
    const photos = await storeFiles(db, u.id, filesOf(req, 'photos'));
    const q = (
      await db.query<QuoteRow>(`INSERT INTO parts_quotes (job_id, part_name, price, photo_evidence) VALUES ($1, $2, $3, $4) RETURNING *`, [
        job.id,
        b.partName,
        Math.round(b.price),
        photos.join(',') || null,
      ])
    ).rows[0];
    await db.query(`UPDATE jobs SET updated_at = now() WHERE id = $1`, [job.id]);
    return { q, job };
  });
  emitTo([out.job.owner_id], 'new_quote_alert', { jobId: out.job.id, quoteId: out.q.id, partName: out.q.part_name, price: Number(out.q.price) });
  res.status(201).json(toQuote(baseUrl(req), out.q));
});

/** POST /mechanic/jobs/:id/complete — 422 while tasks are open or quotes pending (§6.4 fix). */
mechanicRouter.post('/jobs/:id/complete', requireRole('mechanic'), async (req, res) => {
  const u = me(req);
  const out = await tx(async (db) => {
    const job = await assignedJob(db, u, Number(req.params.id), true);
    if (job.status !== 'fixing') throw E.unprocessable('INVALID_STATE', 'This job is not in progress.');
    const tasks = (await db.query<ChecklistRow>(`SELECT * FROM job_checklists WHERE job_id = $1`, [job.id])).rows;
    const quotes = (await db.query<QuoteRow>(`SELECT * FROM parts_quotes WHERE job_id = $1`, [job.id])).rows;
    const openTasks = tasks.filter((t) => !t.is_completed).length;
    const openQuotes = quotes.filter((q) => q.is_approved === null).length;
    if (openTasks || openQuotes) {
      throw E.unprocessable(
        'JOB_NOT_READY',
        [openTasks && `${openTasks} task${openTasks > 1 ? 's' : ''} open`, openQuotes && `${openQuotes} quote${openQuotes > 1 ? 's' : ''} awaiting the owner`]
          .filter(Boolean)
          .join(' · '),
      );
    }
    const totals = computeTotals(quotes.map((q) => toQuote('', q)), await serviceFee(db));
    const done = (
      await db.query<JobRow>(`UPDATE jobs SET status = 'completed', sos_active = false, total_price = $2, updated_at = now() WHERE id = $1 RETURNING *`, [
        job.id,
        totals.total,
      ])
    ).rows[0];
    return { job: await expandJob(db, baseUrl(req), done, u), ownerId: job.owner_id, total: totals.total };
  });
  emitTo([out.ownerId], 'job_finished', { jobId: out.job.id, summary: `Receipt ready · ${formatUGX(out.total)}` });
  res.json(out.job);
});

/** GET /mechanic/earnings?range=day|week|month — {total, today, jobs, series[], payouts[]}. */
mechanicRouter.get('/earnings', requireRole('mechanic'), async (req, res) => {
  const u = me(req);
  const range = z.enum(['day', 'week', 'month']).parse(req.query.range ?? 'week');
  const done = await query<{ id: number; service_type: string; total_price: number; updated_at: Date; model: string | null }>(
    `SELECT j.id, j.service_type, j.total_price, j.updated_at, v.model
     FROM jobs j LEFT JOIN vehicles v ON v.id = j.vehicle_id
     WHERE j.mechanic_id = $1 AND j.status = 'completed' ORDER BY j.updated_at DESC`,
    [u.id],
  );
  // Days are counted in EAT (UTC+3).
  const eatDay = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
  const today = eatDay(new Date());
  const sum = (rows: typeof done) => rows.reduce((s, r) => s + Number(r.total_price), 0);
  const series: { label: string; date: string; amount: number }[] = [];
  if (range === 'month') {
    const now = new Date(Date.now() + 3 * 3600_000);
    for (let i = 5; i >= 0; i--) {
      const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = m.toISOString().slice(0, 7);
      series.push({ label: m.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }), date: `${key}-01`, amount: sum(done.filter((r) => eatDay(r.updated_at).startsWith(key))) });
    }
  } else {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() + 3 * 3600_000 - i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      series.push({ label: d.toLocaleDateString('en-GB', { weekday: 'narrow', timeZone: 'UTC' }), date: key, amount: sum(done.filter((r) => eatDay(r.updated_at) === key)) });
    }
  }
  const inRange = range === 'day' ? done.filter((r) => eatDay(r.updated_at) === today) : done.filter((r) => eatDay(r.updated_at) >= series[0].date);
  res.json({
    total: sum(inRange),
    today: sum(done.filter((r) => eatDay(r.updated_at) === today)),
    jobs: inRange.length,
    series,
    payouts: done.slice(0, 20).map((r) => ({ jobId: r.id, serviceType: r.service_type, vehicle: r.model ?? 'Vehicle', amount: Number(r.total_price), date: r.updated_at.toISOString() })),
  });
});

/** GET /mechanic/reviews — Review[] + average. */
mechanicRouter.get('/reviews', requireRole('mechanic', { allowPending: true }), async (req, res) => {
  const u = me(req);
  const rows = await query<ReviewRow & { owner_name: string; service_type: string }>(
    `SELECT r.*, u.full_name AS owner_name, j.service_type FROM reviews r
     JOIN users u ON u.id = r.owner_id JOIN jobs j ON j.id = r.job_id
     WHERE r.mechanic_id = $1 ORDER BY r.created_at DESC`,
    [u.id],
  );
  res.json({
    reviews: rows.map((r) => ({ ...toReview(r), ownerName: r.owner_name, serviceType: r.service_type })),
    average: await mechanicRating(pool, u.id),
    count: rows.length,
  });
});
