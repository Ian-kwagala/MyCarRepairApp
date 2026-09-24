import { Router } from 'express';
import { z } from 'zod';

import { BOOKING_CHECKLIST, DISPATCH, SERVICE_TYPE_MAX } from '@/constants/config';
import { etaRange } from '@/utils/geo';
import { composeFeedback } from '@/utils/jobs';

import { me, requireAuth, requireRole } from '../auth';
import { pool, query, tx, type Db } from '../db';
import { E } from '../errors';
import { expandAll, expandJob, jobSummary, nearestMechanics, onlineMechanicIds, sosTargets } from '../jobs';
import { toQuote, toReview } from '../mappers';
import { baseUrl, filesOf, storeFiles, upload } from '../media';
import { emitTo } from '../realtime';
import { signReceipt } from '../receipt';
import type { JobRow, QuoteRow, ReviewRow, UserRow } from '../types';

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

const ACTIVE = `('pending', 'accepted', 'diagnosing', 'fixing', 'ready')`;

async function ownVehicle(db: Db, owner: UserRow, vehicleId: number) {
  const v = await db.query(`SELECT id FROM vehicles WHERE id = $1 AND owner_id = $2`, [vehicleId, owner.id]);
  if (!v.rowCount) throw E.notFound('Vehicle');
}

async function insertJob(db: Db, owner: UserRow, vehicleId: number, serviceType: string, sos: boolean) {
  await ownVehicle(db, owner, vehicleId);
  return (
    await db.query<JobRow>(
      `INSERT INTO jobs (owner_id, vehicle_id, service_type, status, sos_active) VALUES ($1, $2, $3, 'pending', $4) RETURNING *`,
      [owner.id, vehicleId, serviceType.slice(0, SERVICE_TYPE_MAX), sos],
    )
  ).rows[0];
}

/** POST /jobs/bookings — job (pending) + default 10-item checklist; dispatched to online mechanics. */
jobsRouter.post('/jobs/bookings', requireRole('owner'), async (req, res) => {
  const u = me(req);
  const b = z
    .object({ vehicleId: z.number().int(), serviceType: z.string().trim().min(2).max(SERVICE_TYPE_MAX), scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notes: z.string().trim().max(500).optional() })
    .parse(req.body);
  // Past dates are rejected server-side too (O7). The device picks "today" in its own timezone, so accept
  // any date that is still today somewhere (UTC−12), which never lets a genuinely past date through.
  const earliestToday = new Date(Date.now() - 12 * 3600_000).toISOString().slice(0, 10);
  if (b.scheduledDate < earliestToday) throw E.validation('Choose today or a future date.');
  const { job, targets, payload } = await tx(async (db) => {
    const row = await insertJob(db, u, b.vehicleId, b.serviceType, false);
    for (const t of BOOKING_CHECKLIST) await db.query(`INSERT INTO job_checklists (job_id, task_description) VALUES ($1, $2)`, [row.id, t]);
    await db.query(`INSERT INTO job_extras (job_id, scheduled_date, notes) VALUES ($1, $2, $3)`, [row.id, b.scheduledDate, b.notes || null]);
    return {
      job: await expandJob(db, baseUrl(req), row, u),
      targets: await onlineMechanicIds(db),
      payload: { jobId: row.id, sos: false, serviceType: row.service_type, summary: await jobSummary(db, row) },
    };
  });
  emitTo(targets, 'new_job_pushed', payload);
  res.status(201).json(job);
});

/** POST /jobs/diagnostics (multipart) — symptoms persisted in jobs.service_type (§6.4 fix). */
jobsRouter.post('/jobs/diagnostics', requireRole('owner'), upload.fields([{ name: 'photo', maxCount: 1 }]), async (req, res) => {
  const u = me(req);
  const raw = req.body ?? {};
  const symptoms = z.array(z.string().trim().min(2).max(40)).min(1, 'Pick at least one symptom.').max(8).parse([raw['symptoms[]'] ?? raw.symptoms ?? []].flat());
  const vehicleId = z.coerce.number().int().parse(raw.vehicleId);
  const notes = z.string().trim().max(500).optional().parse(raw.notes || undefined);
  const { job, targets, payload } = await tx(async (db) => {
    const row = await insertJob(db, u, vehicleId, `Diagnostic: ${symptoms.join(', ')}`, false);
    const [photo] = await storeFiles(db, u.id, filesOf(req, 'photo'));
    await db.query(`INSERT INTO job_extras (job_id, notes, photo) VALUES ($1, $2, $3)`, [row.id, notes || null, photo ?? null]);
    return {
      job: await expandJob(db, baseUrl(req), row, u),
      targets: await onlineMechanicIds(db),
      payload: { jobId: row.id, sos: false, serviceType: row.service_type, summary: await jobSummary(db, row) },
    };
  });
  emitTo(targets, 'new_job_pushed', payload);
  res.status(201).json(job);
});

/** POST /sos {vehicleId, issue, lat, lng} → {jobId, nearbyCount, eta}; nearest 5 online mechanics ≤ 10 km. */
jobsRouter.post('/sos', requireRole('owner'), async (req, res) => {
  const u = me(req);
  const b = z
    .object({ vehicleId: z.number().int(), issue: z.string().trim().min(2).max(SERVICE_TYPE_MAX), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .parse(req.body);
  const out = await tx(async (db) => {
    // Rate limit: 3 SOS per 10 minutes per user (§13.1); one open SOS at a time.
    const recent = await db.query(`SELECT 1 FROM jobs WHERE owner_id = $1 AND sos_active AND created_at > now() - interval '10 minutes'`, [u.id]);
    if ((recent.rowCount ?? 0) >= 3) throw E.tooMany('Too many SOS requests. Please call the emergency line.');
    const open = await db.query(`SELECT 1 FROM jobs WHERE owner_id = $1 AND sos_active AND status IN ('pending', 'accepted')`, [u.id]);
    if (open.rowCount) throw E.conflict('SOS_ALREADY_ACTIVE', 'You already have an active SOS request.');
    await db.query(`UPDATE users SET location_lat = $2, location_lng = $3 WHERE id = $1`, [u.id, b.lat, b.lng]);
    const row = await insertJob(db, u, b.vehicleId, b.issue, true);
    const near = await nearestMechanics(db, b.lat, b.lng, DISPATCH.radiusKm);
    return { row, near, summary: await jobSummary(db, row) };
  });
  for (const t of out.near) {
    emitTo([t.id], 'new_job_pushed', {
      jobId: out.row.id,
      sos: true,
      serviceType: b.issue,
      distanceKm: t.km,
      summary: `${t.km.toFixed(1)} km · ${out.summary}`,
    });
  }
  res.status(201).json({ jobId: out.row.id, status: 'pending', nearbyCount: out.near.length, eta: etaRange(out.near[0]?.km ?? null) });
});

/** POST /sos/:jobId/cancel — status = cancelled (not completed, §6.4). Also cancels a pending booking. */
jobsRouter.post('/sos/:jobId/cancel', requireRole('owner'), async (req, res) => {
  const u = me(req);
  const jobId = Number(req.params.jobId);
  const notify = await tx(async (db) => {
    const job = (await db.query<JobRow>(`SELECT * FROM jobs WHERE id = $1 AND owner_id = $2 FOR UPDATE`, [jobId, u.id])).rows[0];
    if (!job) throw E.notFound('Job');
    if (job.status !== 'pending' || job.mechanic_id != null) throw E.conflict('JOB_NOT_CANCELLABLE', 'A mechanic has already accepted. Call them to cancel.');
    await db.query(`UPDATE jobs SET status = 'cancelled', sos_active = false, updated_at = now() WHERE id = $1`, [jobId]);
    return onlineMechanicIds(db);
  });
  emitTo(notify, 'job_unavailable', { jobId });
  res.status(204).end();
});

/** GET /jobs?scope=active|history — the owner's jobs, newest first. */
jobsRouter.get('/jobs', requireRole('owner'), async (req, res) => {
  const u = me(req);
  const scope = req.query.scope === 'history' ? 'history' : 'active';
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20) || 20));
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const rows = await query<JobRow>(
    `SELECT * FROM jobs WHERE owner_id = $1 AND status ${scope === 'active' ? 'IN' : 'NOT IN'} ${ACTIVE}
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [u.id, limit, (page - 1) * limit],
  );
  res.json(await expandAll(pool, baseUrl(req), rows, u));
});

/** GET /jobs/:id — owner (own) or mechanic (assigned, or an open job they may take). */
jobsRouter.get('/jobs/:id', async (req, res) => {
  const u = me(req);
  const row = (await query<JobRow>(`SELECT * FROM jobs WHERE id = $1`, [Number(req.params.id)]))[0];
  if (!row) throw E.notFound('Job');
  if (u.role === 'owner') {
    if (row.owner_id !== u.id) throw E.notFound('Job');
    res.json(await expandJob(pool, baseUrl(req), row, u));
    return;
  }
  if (u.role === 'mechanic' && u.status === 'active') {
    if (row.mechanic_id === u.id) {
      res.json(await expandJob(pool, baseUrl(req), row, u, { withDistance: true }));
      return;
    }
    if (row.mechanic_id != null) throw E.conflict('JOB_ALREADY_TAKEN', 'Another mechanic accepted this job.');
    if (row.status === 'pending') {
      if (row.sos_active && !(await sosTargets(pool, row)).some((t) => t.id === u.id)) throw E.notFound('Job');
      res.json(await expandJob(pool, baseUrl(req), row, u, { withDistance: true }));
      return;
    }
    if (row.status === 'cancelled') throw E.conflict('JOB_CANCELLED', 'The owner cancelled this request.');
  }
  throw E.notFound('Job');
});

/** POST /quotes/:id/decision {decision: approve|reject} — final; notifies the mechanic. */
jobsRouter.post('/quotes/:id/decision', requireRole('owner'), async (req, res) => {
  const u = me(req);
  const { decision } = z.object({ decision: z.enum(['approve', 'reject']) }).parse(req.body);
  const out = await tx(async (db) => {
    const q = (await db.query<QuoteRow>(`SELECT * FROM parts_quotes WHERE id = $1 FOR UPDATE`, [Number(req.params.id)])).rows[0];
    if (!q) throw E.notFound('Quote');
    const job = (await db.query<JobRow>(`SELECT * FROM jobs WHERE id = $1 AND owner_id = $2`, [q.job_id, u.id])).rows[0];
    if (!job) throw E.notFound('Quote');
    if (q.is_approved !== null) throw E.conflict('QUOTE_ALREADY_DECIDED', 'This quote was already decided.');
    if (['completed', 'cancelled'].includes(job.status)) throw E.unprocessable('JOB_CLOSED', 'This job is closed.');
    const updated = (await db.query<QuoteRow>(`UPDATE parts_quotes SET is_approved = $2 WHERE id = $1 RETURNING *`, [q.id, decision === 'approve'])).rows[0];
    await db.query(`UPDATE jobs SET updated_at = now() WHERE id = $1`, [job.id]);
    return { updated, job };
  });
  if (out.job.mechanic_id) {
    emitTo([out.job.mechanic_id], 'quote_updated', {
      jobId: out.job.id,
      quoteId: out.updated.id,
      summary: `Owner ${decision === 'approve' ? 'approved' : 'declined'} ${out.updated.part_name}`,
    });
  }
  res.json(toQuote(baseUrl(req), out.updated));
});

/** GET /jobs/:id/receipt — signed, short-lived link to the PDF (owner or mechanic of a completed job). */
jobsRouter.get('/jobs/:id/receipt', async (req, res) => {
  const u = me(req);
  const job = (await query<JobRow>(`SELECT * FROM jobs WHERE id = $1`, [Number(req.params.id)]))[0];
  if (!job || (job.owner_id !== u.id && job.mechanic_id !== u.id)) throw E.notFound('Job');
  if (job.status !== 'completed') throw E.unprocessable('JOB_NOT_COMPLETED', 'The receipt is ready once the job is complete.');
  res.json({ url: `${baseUrl(req)}/receipts/${job.id}.pdf?${signReceipt(job.id, u.id)}` });
});

/** POST /jobs/:id/review {rating 1–5, feedback?, tags?} — one review per completed job. */
jobsRouter.post('/jobs/:id/review', requireRole('owner'), async (req, res) => {
  const u = me(req);
  const b = z
    .object({ rating: z.number().int().min(1, 'Pick a rating from 1 to 5 stars.').max(5), feedback: z.string().trim().max(1000).nullable().optional(), tags: z.array(z.string().max(40)).max(10).optional() })
    .parse(req.body);
  const review = await tx(async (db) => {
    const job = (await db.query<JobRow>(`SELECT * FROM jobs WHERE id = $1 AND owner_id = $2`, [Number(req.params.id), u.id])).rows[0];
    if (!job) throw E.notFound('Job');
    if (job.status !== 'completed' || !job.mechanic_id) throw E.unprocessable('JOB_NOT_COMPLETED', 'You can rate once the job is complete.');
    const exists = await db.query(`SELECT 1 FROM reviews WHERE job_id = $1`, [job.id]);
    if (exists.rowCount) throw E.conflict('REVIEW_EXISTS', 'You already reviewed this job.');
    return (
      await db.query<ReviewRow>(`INSERT INTO reviews (job_id, mechanic_id, owner_id, rating, feedback) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [
        job.id,
        job.mechanic_id,
        u.id,
        b.rating,
        composeFeedback(b.tags ?? [], b.feedback ?? ''),
      ])
    ).rows[0];
  });
  res.status(201).json(toReview(review));
});
