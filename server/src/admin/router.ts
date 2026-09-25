import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { Router, type Request, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';

import { SOS_ISSUES } from '@/constants/config';
import { parseFeedback } from '@/utils/jobs';

import { config } from '../config';
import { one, query, tx } from '../db';
import { serviceFee } from '../jobs';
import { emitTo } from '../realtime';
import type { ChecklistRow, JobRow, QuoteRow, ReviewRow, UserRow, VehicleRow } from '../types';
import {
  action,
  ago,
  chips,
  columnChart,
  empty,
  esc,
  fmtDate,
  fmtDateTime,
  icon,
  jobKind,
  jobStatusPill,
  type JobKind,
  kindPill,
  mapsLink,
  num,
  page,
  pager,
  person,
  pill,
  searchBox,
  ugx,
  ugxCompact,
  userStatusPill,
  type NavCounts,
} from './ui';

/**
 * Operations console for MyCarRepair staff: overview, mechanic approvals, jobs, owners, mechanics, password-reset
 * codes and app settings. Protected by HTTP Basic auth with ADMIN_PASSWORD (any username); disabled when unset.
 */
export const adminRouter = Router();

const sha = (s: string) => createHash('sha256').update(s).digest();

// Failed sign-ins only: stops password guessing without getting in the way of normal use.
adminRouter.use(rateLimit({ windowMs: 15 * 60_000, limit: 30, skipSuccessfulRequests: true, standardHeaders: 'draft-8', legacyHeaders: false }));

const auth: RequestHandler = (req, res, next) => {
  if (!config.adminPassword) {
    res.status(404).send('Admin page is disabled. Set ADMIN_PASSWORD to enable it.');
    return;
  }
  const [scheme, value] = (req.headers.authorization ?? '').split(' ');
  const decoded = scheme === 'Basic' && value ? Buffer.from(value, 'base64').toString() : '';
  const pass = decoded.slice(decoded.indexOf(':') + 1);
  if (!decoded.includes(':') || !timingSafeEqual(sha(pass), sha(config.adminPassword))) {
    res.setHeader('WWW-Authenticate', 'Basic realm="MyCarRepair admin", charset="UTF-8"');
    res.status(401).send('Sign in with any username and the admin password.');
    return;
  }
  // CSRF: browsers resend Basic credentials cross-site, so POSTs must come from this origin.
  if (req.method === 'POST') {
    const origin = req.get('origin') ?? req.get('referer') ?? '';
    if (!origin.startsWith(`${req.protocol}://${req.get('host')}`)) {
      res.status(403).send('Cross-site request blocked.');
      return;
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  next();
};
adminRouter.use(auth);

const SCRIPT = readFileSync(new URL('./admin.js', import.meta.url), 'utf8');
adminRouter.get('/assets/admin.js', (_req, res) => {
  res.type('application/javascript').send(SCRIPT);
});

// ── Shared helpers ──────────────────────────────────────────────────────────────────────────────────

const SOS_LIST = [...SOS_ISSUES] as string[];
const SOS_SQL = `(j.sos_active OR j.service_type = ANY($1::text[]))`;
const PAGE_SIZE = 50;

async function chrome() {
  const r = (await one<NavCounts & { maintenance: string | null }>(
    `SELECT (SELECT COUNT(*) FROM users WHERE role = 'mechanic' AND status = 'pending')::int AS pending,
            (SELECT COUNT(*) FROM password_resets WHERE expires_at > now())::int AS resets,
            (SELECT COUNT(*) FROM jobs j WHERE j.status = 'pending' AND j.mechanic_id IS NULL AND ${SOS_SQL})::int AS "openSos",
            (SELECT value FROM system_config WHERE key = 'maintenance_mode') AS maintenance`,
    [SOS_LIST],
  ))!;
  return { counts: { pending: r.pending, resets: r.resets, openSos: r.openSos }, maintenance: r.maintenance === 'true' };
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const like = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;
const pageNo = (req: Request) => Math.max(1, Math.min(1000, Number(req.query.page) || 1));
const mediaSrc = (path: string | null) => (path && /^media\/[A-Za-z0-9._-]+$/.test(path) ? `/${path}` : null);

/** Where to go after a POST: the page it came from (admin pages only), with a notice. */
function backTo(req: Request, notice: string) {
  const raw = str(req.body?.back);
  const safe = raw.startsWith('/admin') && !raw.includes('//') && !raw.includes('\\') && raw.length < 500 ? raw : '/admin';
  const url = new URL(safe, 'http://local');
  url.searchParams.set('notice', notice);
  return `${url.pathname}${url.search}`;
}

interface JobListRow extends JobRow {
  owner_name: string;
  owner_phone: string | null;
  mechanic_name: string | null;
  make: string | null;
  model: string | null;
  plate_number: string | null;
}

const JOB_LIST_SELECT = `SELECT j.*, o.full_name AS owner_name, o.phone AS owner_phone, m.full_name AS mechanic_name, v.make, v.model, v.plate_number
  FROM jobs j JOIN users o ON o.id = j.owner_id LEFT JOIN users m ON m.id = j.mechanic_id LEFT JOIN vehicles v ON v.id = j.vehicle_id`;

function jobsTable(rows: JobListRow[], opts: { compact?: boolean } = {}) {
  if (!rows.length) return empty('No jobs here', 'Jobs appear as soon as owners send an SOS or book a service.');
  const title = (j: JobListRow, kind: JobKind) =>
    `<a class="strong" href="/admin/jobs/${j.id}">#${j.id} · ${esc(kind === 'Diagnostic' ? 'Diagnostic' : j.service_type)}</a><br>${kindPill(kind)}`;
  const mech = (j: JobListRow) =>
    j.mechanic_id ? person(j.mechanic_name, null, `/admin/users/${j.mechanic_id}`) : '<span class="muted">Not assigned</span>';
  const when = (j: JobListRow) => `<span title="${esc(fmtDateTime(j.created_at))}">${esc(ago(j.created_at))}</span>`;
  if (opts.compact) {
    return `<div class="scroll"><table class="t"><thead><tr><th>Job</th><th>Status</th><th>Owner</th><th>Created</th></tr></thead><tbody>${rows
      .map((j) => {
        const who = j.mechanic_id ? `<br><span class="muted small">${esc(j.mechanic_name)}</span>` : '';
        return `<tr><td>${title(j, jobKind(j))}</td><td>${jobStatusPill(j.status)}${who}</td><td>${person(j.owner_name, j.owner_phone, `/admin/users/${j.owner_id}`)}</td><td>${when(j)}</td></tr>`;
      })
      .join('')}</tbody></table></div>`;
  }
  return `<div class="scroll"><table class="t"><thead><tr><th>Job</th><th>Status</th><th>Owner</th><th>Mechanic</th><th>Vehicle</th><th>Created</th><th class="num">Total</th></tr></thead><tbody>${rows
    .map(
      (j) => `<tr><td>${title(j, jobKind(j))}</td><td>${jobStatusPill(j.status)}</td><td>${person(j.owner_name, j.owner_phone, `/admin/users/${j.owner_id}`)}</td><td>${mech(j)}</td>
<td>${j.plate_number ? `${esc(j.make)} ${esc(j.model)}<br><span class="muted small">${esc(j.plate_number)}</span>` : '<span class="muted">—</span>'}</td>
<td>${when(j)}</td><td class="num">${Number(j.total_price) ? esc(ugx(j.total_price)) : '<span class="muted">—</span>'}</td></tr>`,
    )
    .join('')}</tbody></table></div>`;
}

/** Review text: quick-tags (stored as a "[tag, tag]" prefix) as pills, then the comment. */
function feedback(text: string | null) {
  const { tags, comment } = parseFeedback(text);
  return `${tags.length ? `<div class="chips" style="margin-top:6px">${tags.map((t) => pill(t, 'brand')).join('')}</div>` : ''}${comment ? `<p style="margin:6px 0 0">${esc(comment)}</p>` : ''}`;
}

function userActions(u: Pick<UserRow, 'id' | 'role' | 'status' | 'full_name'>, back: string) {
  if (u.status === 'pending')
    return `${action(`/admin/users/${u.id}/approve`, 'Approve', back, 'success')} ${action(`/admin/users/${u.id}/suspend`, 'Reject', back, 'danger', `Reject ${u.full_name}'s application? Their account will be suspended.`)}`;
  if (u.status === 'suspended') return action(`/admin/users/${u.id}/approve`, 'Reactivate', back, 'ghost', `Reactivate ${u.full_name}'s account?`);
  return action(`/admin/users/${u.id}/suspend`, 'Suspend', back, 'danger', `Suspend ${u.full_name}? They will be signed out on every device${u.role === 'mechanic' ? ' and taken offline' : ''}.`);
}

function approvalCard(m: UserRow, back: string) {
  return `<div class="approval"><div>${person(m.full_name, `Signed up ${ago(m.created_at)}`, `/admin/users/${m.id}`)}
<div class="meta"><span>${icon('wrench', 15)} <b>${esc(m.garage_name || 'No garage name')}</b>${m.garage_location ? ` · ${esc(m.garage_location)}` : ''}</span>
<span>${icon('phone', 15)} ${m.phone ? `<a href="tel:${esc(m.phone)}">${esc(m.phone)}</a>` : '—'}</span><span>${esc(m.email)}</span></div>
${m.expertise ? `<p class="muted small" style="margin:6px 0 0">Expertise: ${esc(m.expertise)}</p>` : ''}</div>
<div class="actions">${userActions(m, back)}</div></div>`;
}

// ── Overview ────────────────────────────────────────────────────────────────────────────────────────

adminRouter.get('/', async (req, res) => {
  const { counts, maintenance } = await chrome();
  const s = (await one<Record<string, number>>(
    `SELECT (SELECT COUNT(*) FROM users WHERE role = 'owner')::int AS owners,
            (SELECT COUNT(*) FROM users WHERE role = 'owner' AND created_at > now() - interval '7 days')::int AS owners_week,
            (SELECT COUNT(*) FROM users WHERE role = 'mechanic' AND status = 'active')::int AS mechanics,
            (SELECT COUNT(*) FROM users WHERE role = 'mechanic' AND status = 'active' AND is_online)::int AS online,
            (SELECT COUNT(*) FROM jobs WHERE status NOT IN ('completed', 'cancelled') AND mechanic_id IS NOT NULL)::int AS in_progress,
            (SELECT COUNT(*) FROM jobs WHERE status = 'pending' AND mechanic_id IS NULL)::int AS waiting,
            (SELECT COUNT(*) FROM jobs WHERE status = 'completed')::int AS done,
            (SELECT COUNT(*) FROM jobs WHERE status = 'completed' AND updated_at > now() - interval '30 days')::int AS done30,
            (SELECT COALESCE(SUM(total_price), 0) FROM jobs WHERE status = 'completed') AS value,
            (SELECT COALESCE(SUM(total_price), 0) FROM jobs WHERE status = 'completed' AND updated_at > now() - interval '30 days') AS value30`,
  ))!;
  // Jobs created per day over the last 14 days, in Kampala time.
  const days = await query<{ day: string; n: number }>(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day, COUNT(j.id)::int AS n
     FROM generate_series((now() + interval '3 hours')::date - 13, (now() + interval '3 hours')::date, interval '1 day') AS d
     LEFT JOIN jobs j ON (j.created_at + interval '3 hours')::date = d::date
     GROUP BY d ORDER BY d`,
  );
  const live = await query<JobListRow>(
    `${JOB_LIST_SELECT} WHERE j.status NOT IN ('completed', 'cancelled') ORDER BY (j.mechanic_id IS NULL) DESC, j.created_at DESC LIMIT 8`,
  );
  const pending = await query<UserRow>(`SELECT * FROM users WHERE role = 'mechanic' AND status = 'pending' ORDER BY created_at LIMIT 5`);
  const recent = await query<UserRow>(`SELECT * FROM users WHERE role <> 'admin' ORDER BY created_at DESC LIMIT 6`);

  const tile = (href: string, label: string, value: string, note: string, alert = false) =>
    `<a class="tile${alert ? ' alert' : ''}" href="${href}"><div class="label">${label}</div><div class="value">${value}</div><div class="note">${note}</div></a>`;
  const chart = columnChart(
    days.map((d) => {
      const dt = new Date(`${d.day}T12:00:00Z`);
      return { label: String(dt.getUTCDate()), full: fmtDate(new Date(dt.getTime() - 3 * 3600_000)), value: d.n };
    }),
    'jobs',
  );
  const total14 = days.reduce((a, d) => a + d.n, 0);

  const body = `<section class="tiles" aria-label="Key numbers">
${tile('/admin/jobs?status=open&type=sos', 'Open SOS', num(counts.openSos), counts.openSos ? 'Waiting for a mechanic now' : 'Nobody stranded', counts.openSos > 0)}
${tile('/admin/jobs?status=active', 'Jobs in progress', num(s.in_progress!), `${num(s.waiting!)} waiting for a mechanic`)}
${tile('/admin/mechanics?status=online', 'Mechanics online', num(s.online!), `of ${num(s.mechanics!)} approved mechanics`)}
${tile('/admin/approvals', 'Awaiting approval', num(counts.pending), counts.pending ? 'Mechanics to verify' : 'All caught up')}
${tile('/admin/owners', 'Car owners', num(s.owners!), `+${num(s.owners_week!)} this week`)}
${tile('/admin/jobs?status=completed', 'Completed (30 days)', num(s.done30!), `${num(s.done!)} all time`)}
${tile('/admin/jobs?status=completed', 'Job value (30 days)', esc(ugxCompact(s.value30!)), `${esc(ugxCompact(s.value!))} all time`)}
</section>
<div class="grid2"><div>
<section class="card"><div class="card-h"><h2>Live jobs</h2><a href="/admin/jobs?status=open">View all</a></div>${jobsTable(live, { compact: true })}</section>
<section class="card"><div class="card-h"><h2>Jobs per day</h2><span class="muted small">Last 14 days · ${num(total14)} jobs</span></div><div class="card-b">${chart}</div></section>
</div><div>
<section class="card"><div class="card-h"><h2>Mechanics awaiting approval</h2>${counts.pending ? `<a href="/admin/approvals">View all ${counts.pending}</a>` : ''}</div>
${pending.length ? pending.map((m) => approvalCard(m, '/admin')).join('') : empty('Nobody is waiting', 'New mechanic sign-ups appear here for verification.')}</section>
<section class="card"><div class="card-h"><h2>Newest accounts</h2></div>${
    recent.length
      ? `<table class="t"><tbody>${recent
          .map(
            (u) =>
              `<tr><td>${person(u.full_name, u.role === 'mechanic' ? u.garage_name || 'Mechanic' : 'Car owner', `/admin/users/${u.id}`)}</td><td class="num"><span class="muted small">${esc(ago(u.created_at))}</span></td></tr>`,
          )
          .join('')}</tbody></table>`
      : empty('No accounts yet', 'Accounts created in the apps show up here.')
  }</section>
</div></div>`;
  res.send(page({ title: 'Overview', active: '/admin', counts, maintenance, notice: str(req.query.notice), body, refreshSeconds: 30, subtitle: 'Live picture of MyCarRepair right now. Refreshes every 30 seconds.' }));
});

// ── Approvals ───────────────────────────────────────────────────────────────────────────────────────

adminRouter.get('/approvals', async (req, res) => {
  const { counts, maintenance } = await chrome();
  const pending = await query<UserRow>(`SELECT * FROM users WHERE role = 'mechanic' AND status = 'pending' ORDER BY created_at`);
  const body = `<section class="card"><div class="card-h"><h2>Waiting for verification (${pending.length})</h2></div>
${pending.length ? pending.map((m) => approvalCard(m, '/admin/approvals')).join('') : empty('Nobody is waiting', 'New mechanic sign-ups appear here for verification.')}</section>
<section class="card"><div class="card-b"><h2>Before approving</h2><p class="muted" style="margin:6px 0 0">Call the mechanic on the number above, confirm the garage exists at the stated location and check their ID. Approved mechanics can go online at once and receive SOS requests from owners nearby.</p></div></section>`;
  res.send(page({ title: 'Mechanic approvals', active: '/admin/approvals', counts, maintenance, notice: str(req.query.notice), body, refreshSeconds: 30, subtitle: 'Verify new mechanics before they can take jobs.' }));
});

// ── Jobs ────────────────────────────────────────────────────────────────────────────────────────────

const JOB_STATUS = ['all', 'open', 'active', 'completed', 'cancelled'] as const;
const JOB_TYPE = ['all', 'sos', 'booking', 'diagnostic'] as const;

adminRouter.get('/jobs', async (req, res) => {
  const { counts, maintenance } = await chrome();
  const status = pick(req.query.status, JOB_STATUS, 'all');
  const type = pick(req.query.type, JOB_TYPE, 'all');
  const q = str(req.query.q).trim().slice(0, 100);
  const p = pageNo(req);
  const params: unknown[] = [];
  const arg = (v: unknown) => `$${params.push(v)}`;
  const sos = () => `(j.sos_active OR j.service_type = ANY(${arg(SOS_LIST)}::text[]))`;
  const where: string[] = [];
  if (status === 'open') where.push(`j.status = 'pending' AND j.mechanic_id IS NULL`);
  if (status === 'active') where.push(`j.status NOT IN ('completed', 'cancelled') AND j.mechanic_id IS NOT NULL`);
  if (status === 'completed' || status === 'cancelled') where.push(`j.status = ${arg(status)}`);
  if (type === 'sos') where.push(sos());
  if (type === 'diagnostic') where.push(`j.service_type LIKE 'Diagnostic:%'`);
  if (type === 'booking') where.push(`NOT ${sos()} AND j.service_type NOT LIKE 'Diagnostic:%'`);
  if (q) {
    const text = arg(like(q));
    where.push(
      `(o.full_name ILIKE ${text} OR o.phone ILIKE ${text} OR o.email ILIKE ${text} OR m.full_name ILIKE ${text} OR v.plate_number ILIKE ${text} OR j.service_type ILIKE ${text} OR j.id::text = ${arg(q.replace(/^#/, ''))})`,
    );
  }
  const rows = await query<JobListRow>(
    `${JOB_LIST_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY j.created_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${(p - 1) * PAGE_SIZE}`,
    params,
  );
  const keep = { status: status === 'all' ? '' : status, type: type === 'all' ? '' : type, q };
  const body = `<section class="card"><div class="toolbar">${chips('/admin/jobs', 'status', status, [['all', 'All'], ['open', 'Waiting'], ['active', 'In progress'], ['completed', 'Completed'], ['cancelled', 'Cancelled']], keep)}
${searchBox('/admin/jobs', q, 'Search owner, mechanic, plate or job #', { status: keep.status, type: keep.type })}</div>
<div class="toolbar">${chips('/admin/jobs', 'type', type, [['all', 'All types'], ['sos', 'SOS'], ['booking', 'Bookings'], ['diagnostic', 'Diagnostics']], keep)}</div>
${jobsTable(rows.slice(0, PAGE_SIZE))}${pager('/admin/jobs', p, rows.length > PAGE_SIZE, keep)}</section>`;
  res.send(page({ title: 'Jobs', active: '/admin/jobs', counts, maintenance, notice: str(req.query.notice), body, refreshSeconds: 30, subtitle: 'Every SOS, booking and diagnostic request.' }));
});

adminRouter.get('/jobs/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { counts, maintenance } = await chrome();
  const job = Number.isInteger(id) ? await one<JobRow>(`SELECT * FROM jobs WHERE id = $1`, [id]) : undefined;
  if (!job) {
    res.status(404).send(page({ title: 'Job not found', active: '/admin/jobs', counts, maintenance, back: { href: '/admin/jobs', label: 'Jobs' }, body: empty('This job does not exist') }));
    return;
  }
  const [owner, mechanic, vehicle, extras, checklist, quotes, review, fee] = await Promise.all([
    one<UserRow>(`SELECT * FROM users WHERE id = $1`, [job.owner_id]),
    job.mechanic_id ? one<UserRow>(`SELECT * FROM users WHERE id = $1`, [job.mechanic_id]) : Promise.resolve(undefined),
    job.vehicle_id ? one<VehicleRow>(`SELECT * FROM vehicles WHERE id = $1`, [job.vehicle_id]) : Promise.resolve(undefined),
    one<{ scheduled_date: string | null; notes: string | null; photo: string | null }>(`SELECT * FROM job_extras WHERE job_id = $1`, [id]),
    query<ChecklistRow>(`SELECT * FROM job_checklists WHERE job_id = $1 ORDER BY id`, [id]),
    query<QuoteRow>(`SELECT * FROM parts_quotes WHERE job_id = $1 ORDER BY created_at`, [id]),
    one<ReviewRow>(`SELECT * FROM reviews WHERE job_id = $1`, [id]),
    serviceFee(),
  ]);
  const kind = jobKind(job);
  const partsApproved = quotes.filter((q) => q.is_approved === true).reduce((a, q) => a + Number(q.price), 0);
  const done = checklist.filter((c) => c.is_completed).length;
  const contact = (u: UserRow) =>
    `<dl class="kv"><dt>Name</dt><dd><a href="/admin/users/${u.id}">${esc(u.full_name)}</a></dd><dt>Phone</dt><dd>${u.phone ? `<a href="tel:${esc(u.phone)}">${esc(u.phone)}</a>` : '—'}</dd><dt>Email</dt><dd>${esc(u.email)}</dd></dl>`;
  const photo = (path: string | null, alt: string) => {
    const src = mediaSrc(path);
    return src ? `<a href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${esc(alt)}" loading="lazy"></a>` : '';
  };

  const body = `<div class="grid2"><div>
<section class="card"><div class="card-h"><h2>Progress</h2><span class="muted small">Updated ${esc(ago(job.updated_at))}</span></div><div class="card-b">
<dl class="kv"><dt>Status</dt><dd>${jobStatusPill(job.status)}</dd><dt>Type</dt><dd>${kindPill(kind)}</dd><dt>Service</dt><dd>${esc(job.service_type)}</dd>
<dt>Created</dt><dd>${esc(fmtDateTime(job.created_at))}</dd>${extras?.scheduled_date ? `<dt>Booked for</dt><dd>${esc(fmtDate(new Date(`${extras.scheduled_date}T09:00:00Z`)))}</dd>` : ''}
${extras?.notes ? `<dt>Owner's notes</dt><dd>${esc(extras.notes)}</dd>` : ''}${kind === 'SOS' && owner ? `<dt>SOS location</dt><dd>${mapsLink(owner.location_lat, owner.location_lng)}</dd>` : ''}</dl>
${extras?.photo ? `<div class="photos" style="margin-top:12px">${photo(extras.photo, 'Photo from the owner')}</div>` : ''}</div></section>
<section class="card"><div class="card-h"><h2>Job card</h2><span class="muted small">${done} of ${checklist.length} tasks done</span></div><div class="card-b">${
    checklist.length
      ? checklist
          .map(
            (c) =>
              `<div class="check"><span class="box${c.is_completed ? ' done' : ''}" aria-label="${c.is_completed ? 'Done' : 'Not done'}"></span><span style="flex:1">${esc(c.task_description)}</span>${c.completed_at ? `<span class="muted small">${esc(fmtDateTime(c.completed_at))}</span>` : ''}${mediaSrc(c.photo_url) ? `<a href="${mediaSrc(c.photo_url)}" target="_blank" rel="noopener" class="small">Photo</a>` : ''}</div>`,
          )
          .join('')
      : '<p class="muted" style="margin:0">The checklist starts when the mechanic arrives.</p>'
  }</div></section>
<section class="card"><div class="card-h"><h2>Parts quotes</h2></div>${
    quotes.length
      ? `<table class="t"><thead><tr><th>Part</th><th>Decision</th><th class="num">Price</th></tr></thead><tbody>${quotes
          .map(
            (q) =>
              `<tr><td><div class="person">${mediaSrc(q.photo_evidence) ? `<a href="${mediaSrc(q.photo_evidence)}" target="_blank" rel="noopener"><img src="${mediaSrc(q.photo_evidence)}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:6px"></a>` : ''}<span class="strong">${esc(q.part_name)}</span></div></td>
<td>${q.is_approved === true ? pill('Approved', 'success') : q.is_approved === false ? pill('Declined', 'neutral') : pill('Waiting for owner', 'warning')}</td><td class="num">${esc(ugx(q.price))}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : '<div class="card-b"><p class="muted" style="margin:0">No parts quoted.</p></div>'
  }</section>
</div><div>
<section class="card"><div class="card-h"><h2>Bill</h2></div><div class="card-b"><dl class="kv"><dt>Service fee</dt><dd class="num" style="text-align:left">${esc(ugx(fee))}</dd><dt>Approved parts</dt><dd>${esc(ugx(partsApproved))}</dd>
<dt><b>Total</b></dt><dd><b>${Number(job.total_price) ? esc(ugx(job.total_price)) : '—'}</b></dd></dl></div></section>
<section class="card"><div class="card-h"><h2>Car owner</h2></div><div class="card-b">${owner ? contact(owner) : '—'}</div></section>
<section class="card"><div class="card-h"><h2>Mechanic</h2></div><div class="card-b">${mechanic ? `${contact(mechanic)}${mechanic.garage_name ? `<p class="muted small" style="margin:8px 0 0">${esc(mechanic.garage_name)}${mechanic.garage_location ? ` · ${esc(mechanic.garage_location)}` : ''}</p>` : ''}` : '<p class="muted" style="margin:0">No mechanic has accepted yet.</p>'}</div></section>
<section class="card"><div class="card-h"><h2>Vehicle</h2></div><div class="card-b">${
    vehicle
      ? `<dl class="kv"><dt>Car</dt><dd>${esc(vehicle.make)} ${esc(vehicle.model)} (${vehicle.year})</dd><dt>Plate</dt><dd>${esc(vehicle.plate_number)}</dd>${vehicle.color ? `<dt>Colour</dt><dd>${esc(vehicle.color)}</dd>` : ''}${vehicle.tyre_size ? `<dt>Tyre size</dt><dd>${esc(vehicle.tyre_size)}</dd>` : ''}${vehicle.mileage != null ? `<dt>Mileage</dt><dd>${num(vehicle.mileage)} km</dd>` : ''}</dl>`
      : '<p class="muted" style="margin:0">Vehicle removed.</p>'
  }</div></section>
${review ? `<section class="card"><div class="card-h"><h2>Owner's review</h2></div><div class="card-b"><div class="stars" aria-label="${review.rating} of 5 stars">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</div>${feedback(review.feedback)}</div></section>` : ''}
</div></div>`;
  res.send(
    page({
      title: `Job #${job.id} · ${kind === 'Diagnostic' ? 'Diagnostic' : job.service_type}`,
      active: '/admin/jobs',
      counts,
      maintenance,
      back: { href: '/admin/jobs', label: 'Jobs' },
      subtitle: `${kindPill(kind)} ${jobStatusPill(job.status)}`,
      body,
      refreshSeconds: job.status === 'completed' || job.status === 'cancelled' ? undefined : 30,
    }),
  );
});

// ── People ──────────────────────────────────────────────────────────────────────────────────────────

interface OwnerListRow extends UserRow {
  cars: number;
  jobs: number;
  last_job: Date | null;
}
interface MechanicListRow extends UserRow {
  done: number;
  earned: number;
  rating: number | null;
  reviews: number;
}

function peopleFilter(req: Request, statuses: readonly string[]) {
  const status = pick(str(req.query.status), statuses, 'all');
  const q = str(req.query.q).trim().slice(0, 100);
  const params: unknown[] = [];
  const where: string[] = [];
  if (status === 'online') where.push(`u.status = 'active' AND u.is_online`);
  else if (status !== 'all') {
    params.push(status);
    where.push(`u.status = $${params.length}`);
  }
  if (q) {
    params.push(like(q));
    const n = params.length;
    where.push(`(u.full_name ILIKE $${n} OR u.email ILIKE $${n} OR u.phone ILIKE $${n} OR u.garage_name ILIKE $${n} OR u.garage_location ILIKE $${n})`);
  }
  return { status, q, params, where: where.map((w) => ` AND ${w}`).join('') };
}

adminRouter.get('/owners', async (req, res) => {
  const { counts, maintenance } = await chrome();
  const f = peopleFilter(req, ['all', 'active', 'suspended']);
  const p = pageNo(req);
  const rows = await query<OwnerListRow>(
    `SELECT u.*, (SELECT COUNT(*) FROM vehicles v WHERE v.owner_id = u.id)::int AS cars, (SELECT COUNT(*) FROM jobs j WHERE j.owner_id = u.id)::int AS jobs,
            (SELECT MAX(created_at) FROM jobs j WHERE j.owner_id = u.id) AS last_job
     FROM users u WHERE u.role = 'owner'${f.where} ORDER BY u.created_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${(p - 1) * PAGE_SIZE}`,
    f.params,
  );
  const keep = { status: f.status === 'all' ? '' : f.status, q: f.q };
  const back = req.originalUrl;
  const table = rows.length
    ? `<div class="scroll"><table class="t"><thead><tr><th>Owner</th><th>Phone</th><th class="num">Cars</th><th class="num">Jobs</th><th>Last job</th><th>Joined</th><th>Status</th><th></th></tr></thead><tbody>${rows
        .slice(0, PAGE_SIZE)
        .map(
          (u) =>
            `<tr><td>${person(u.full_name, u.email, `/admin/users/${u.id}`)}</td><td>${u.phone ? `<a href="tel:${esc(u.phone)}">${esc(u.phone)}</a>` : '—'}</td><td class="num">${u.cars}</td><td class="num">${u.jobs}</td>
<td>${u.last_job ? esc(ago(u.last_job)) : '<span class="muted">—</span>'}</td><td>${esc(fmtDate(u.created_at))}</td><td>${userStatusPill(u.status)}</td><td><div class="actions">${userActions(u, back)}</div></td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : empty(f.q ? 'No owners match your search' : 'No car owners yet', f.q ? '' : 'Owners appear here when they sign up in the MyCarRepair app.');
  const body = `<section class="card"><div class="toolbar">${chips('/admin/owners', 'status', f.status, [['all', 'All'], ['active', 'Active'], ['suspended', 'Suspended']], keep)}
${searchBox('/admin/owners', f.q, 'Search name, email or phone', { status: keep.status })}</div>${table}${pager('/admin/owners', p, rows.length > PAGE_SIZE, keep)}</section>`;
  res.send(page({ title: 'Car owners', active: '/admin/owners', counts, maintenance, notice: str(req.query.notice), body, subtitle: 'Everyone using the MyCarRepair app.' }));
});

adminRouter.get('/mechanics', async (req, res) => {
  const { counts, maintenance } = await chrome();
  const f = peopleFilter(req, ['all', 'online', 'active', 'pending', 'suspended']);
  const p = pageNo(req);
  const rows = await query<MechanicListRow>(
    `SELECT u.*, (SELECT COUNT(*) FROM jobs j WHERE j.mechanic_id = u.id AND j.status = 'completed')::int AS done,
            (SELECT COALESCE(SUM(total_price), 0) FROM jobs j WHERE j.mechanic_id = u.id AND j.status = 'completed') AS earned,
            (SELECT AVG(rating) FROM reviews r WHERE r.mechanic_id = u.id) AS rating, (SELECT COUNT(*) FROM reviews r WHERE r.mechanic_id = u.id)::int AS reviews
     FROM users u WHERE u.role = 'mechanic'${f.where} ORDER BY (u.status = 'pending') DESC, u.is_online DESC, u.created_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${(p - 1) * PAGE_SIZE}`,
    f.params,
  );
  const keep = { status: f.status === 'all' ? '' : f.status, q: f.q };
  const back = req.originalUrl;
  const table = rows.length
    ? `<div class="scroll"><table class="t"><thead><tr><th>Mechanic</th><th>Garage</th><th>Status</th><th>Rating</th><th class="num">Jobs done</th><th class="num">Earned</th><th>Joined</th><th></th></tr></thead><tbody>${rows
        .slice(0, PAGE_SIZE)
        .map(
          (u) =>
            `<tr><td>${person(u.full_name, u.phone ?? u.email, `/admin/users/${u.id}`)}</td><td>${esc(u.garage_name || '—')}<br><span class="muted small">${esc(u.garage_location || '')}</span></td>
<td>${userStatusPill(u.status)}${u.status === 'active' ? `<br><span class="small"><span class="dot${u.is_online ? ' on' : ''}"></span>${u.is_online ? 'Online' : 'Offline'}</span>` : ''}</td>
<td>${u.reviews ? `<span class="stars">★</span> ${Number(u.rating).toFixed(1)} <span class="muted small">(${u.reviews})</span>` : '<span class="muted">New</span>'}</td>
<td class="num">${u.done}</td><td class="num">${esc(ugx(u.earned))}</td><td>${esc(fmtDate(u.created_at))}</td><td><div class="actions">${userActions(u, back)}</div></td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : empty(f.q ? 'No mechanics match your search' : 'No mechanics here', f.q ? '' : 'Mechanics appear here when they sign up in the MCR Mechanic app.');
  const body = `<section class="card"><div class="toolbar">${chips('/admin/mechanics', 'status', f.status, [['all', 'All'], ['online', 'Online now'], ['active', 'Approved'], ['pending', 'Awaiting approval'], ['suspended', 'Suspended']], keep)}
${searchBox('/admin/mechanics', f.q, 'Search name, garage or phone', { status: keep.status })}</div>${table}${pager('/admin/mechanics', p, rows.length > PAGE_SIZE, keep)}</section>`;
  res.send(page({ title: 'Mechanics', active: '/admin/mechanics', counts, maintenance, notice: str(req.query.notice), body, refreshSeconds: 60, subtitle: 'Garages and mechanics on MCR Mechanic.' }));
});

adminRouter.get('/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { counts, maintenance } = await chrome();
  const u = Number.isInteger(id) ? await one<UserRow>(`SELECT * FROM users WHERE id = $1 AND role <> 'admin'`, [id]) : undefined;
  if (!u) {
    res.status(404).send(page({ title: 'Account not found', active: '/admin', counts, maintenance, back: { href: '/admin', label: 'Overview' }, body: empty('This account does not exist') }));
    return;
  }
  const mech = u.role === 'mechanic';
  const listHref = mech ? '/admin/mechanics' : '/admin/owners';
  const jobs = await query<JobListRow>(`${JOB_LIST_SELECT} WHERE j.${mech ? 'mechanic_id' : 'owner_id'} = $1 ORDER BY j.created_at DESC LIMIT 50`, [id]);
  const profile = `<section class="card"><div class="card-h"><h2>Account</h2>${userStatusPill(u.status)}</div><div class="card-b"><dl class="kv">
<dt>Name</dt><dd>${esc(u.full_name)}</dd><dt>Phone</dt><dd>${u.phone ? `<a href="tel:${esc(u.phone)}">${esc(u.phone)}</a>` : '—'}</dd><dt>Email</dt><dd><a href="mailto:${esc(u.email)}">${esc(u.email)}</a></dd>
<dt>Joined</dt><dd>${esc(fmtDateTime(u.created_at))}</dd>${mech ? `<dt>Garage</dt><dd>${esc(u.garage_name || '—')}</dd><dt>Garage location</dt><dd>${esc(u.garage_location || '—')}</dd><dt>Expertise</dt><dd>${esc(u.expertise || '—')}</dd><dt>Availability</dt><dd><span class="dot${u.is_online ? ' on' : ''}"></span>${u.is_online ? 'Online now' : 'Offline'}</dd>` : ''}
<dt>Last location</dt><dd>${mapsLink(u.location_lat, u.location_lng)}</dd></dl></div></section>`;

  let side = '';
  if (mech) {
    const st = (await one<{ done: number; earned: number; rating: number | null; reviews: number }>(
      `SELECT (SELECT COUNT(*) FROM jobs WHERE mechanic_id = $1 AND status = 'completed')::int AS done,
              (SELECT COALESCE(SUM(total_price), 0) FROM jobs WHERE mechanic_id = $1 AND status = 'completed') AS earned,
              (SELECT AVG(rating) FROM reviews WHERE mechanic_id = $1) AS rating, (SELECT COUNT(*) FROM reviews WHERE mechanic_id = $1)::int AS reviews`,
      [id],
    ))!;
    const reviews = await query<ReviewRow & { owner_name: string }>(
      `SELECT r.*, o.full_name AS owner_name FROM reviews r JOIN users o ON o.id = r.owner_id WHERE r.mechanic_id = $1 ORDER BY r.created_at DESC LIMIT 10`,
      [id],
    );
    side = `<section class="tiles compact"><div class="tile"><div class="label">Jobs done</div><div class="value">${num(st.done)}</div></div>
<div class="tile"><div class="label">Earned (UGX)</div><div class="value">${esc(ugxCompact(st.earned).replace('UGX ', ''))}</div></div><div class="tile"><div class="label">Rating</div><div class="value">${st.reviews ? Number(st.rating).toFixed(1) : '—'}</div><div class="note">${st.reviews} review${st.reviews === 1 ? '' : 's'}</div></div></section>
<section class="card"><div class="card-h"><h2>Latest reviews</h2></div>${
      reviews.length
        ? reviews
            .map(
              (r) =>
                `<div class="card-b" style="border-bottom:1px solid var(--line2)"><span class="stars" aria-label="${r.rating} of 5 stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span> <span class="muted small">${esc(r.owner_name)} · ${esc(ago(r.created_at))}</span>${feedback(r.feedback)}</div>`,
            )
            .join('')
        : empty('No reviews yet')
    }</section>`;
  } else {
    const cars = await query<VehicleRow>(`SELECT * FROM vehicles WHERE owner_id = $1 ORDER BY created_at DESC`, [id]);
    side = `<section class="card"><div class="card-h"><h2>Garage (${cars.length})</h2></div>${
      cars.length
        ? `<table class="t"><tbody>${cars
            .map((v) => {
              const first = mediaSrc((v.photos ?? '').split(',')[0]?.trim() ?? null);
              return `<tr><td><div class="person">${first ? `<img src="${first}" alt="" style="width:48px;height:36px;object-fit:cover;border-radius:6px">` : ''}<div><span class="strong">${esc(v.make)} ${esc(v.model)} ${v.year}</span><span class="muted small">${esc(v.plate_number)}${v.fuel_type ? ` · ${esc(v.fuel_type)}` : ''}</span></div></div></td></tr>`;
            })
            .join('')}</tbody></table>`
        : empty('No cars saved')
    }</section>`;
  }
  const body = `<div class="grid2"><div>${profile}<section class="card"><div class="card-h"><h2>Jobs (${jobs.length}${jobs.length === 50 ? '+' : ''})</h2></div>${jobsTable(jobs, { compact: true })}</section></div><div>${side}</div></div>`;
  res.send(
    page({
      title: u.full_name,
      active: listHref,
      counts,
      maintenance,
      notice: str(req.query.notice),
      back: { href: listHref, label: mech ? 'Mechanics' : 'Car owners' },
      subtitle: mech ? `Mechanic${u.garage_name ? ` · ${esc(u.garage_name)}` : ''}` : 'Car owner',
      actions: `<div class="actions">${userActions(u, `/admin/users/${u.id}`)}</div>`,
      body,
    }),
  );
});

adminRouter.post('/users/:id/approve', async (req, res) => {
  const id = Number(req.params.id);
  const before = await one<UserRow>(`SELECT * FROM users WHERE id = $1 AND role <> 'admin'`, [id]);
  const [u] = await query<UserRow>(`UPDATE users SET status = 'active' WHERE id = $1 AND role <> 'admin' RETURNING *`, [id]);
  // Push "You're verified — go online" (§8).
  if (u?.role === 'mechanic' && before?.status === 'pending') emitTo([u.id], 'mechanic_approved', {});
  res.redirect(303, backTo(req, before?.status === 'pending' ? 'approved' : 'reactivated'));
});

adminRouter.post('/users/:id/suspend', async (req, res) => {
  const id = Number(req.params.id);
  const before = await one<UserRow>(`SELECT * FROM users WHERE id = $1 AND role <> 'admin'`, [id]);
  await tx(async (db) => {
    await db.query(`UPDATE users SET status = 'suspended', is_online = false WHERE id = $1 AND role <> 'admin'`, [id]);
    await db.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [id]);
  });
  res.redirect(303, backTo(req, before?.status === 'pending' ? 'rejected' : 'suspended'));
});

// ── Password resets ─────────────────────────────────────────────────────────────────────────────────

adminRouter.get('/resets', async (req, res) => {
  const { counts, maintenance } = await chrome();
  const resets = await query<{ id: number; full_name: string; email: string; phone: string | null; role: string; code_hint: string; expires_at: Date }>(
    `SELECT u.id, u.full_name, u.email, u.phone, u.role, p.code_hint, p.expires_at FROM password_resets p JOIN users u ON u.id = p.user_id
     WHERE p.expires_at > now() ORDER BY p.expires_at`,
  );
  const body = `<section class="card"><div class="card-h"><h2>Active codes (${resets.length})</h2><span class="muted small">Codes expire 15 minutes after they are requested</span></div>${
    resets.length
      ? `<div class="scroll"><table class="t"><thead><tr><th>Account</th><th>Phone</th><th>Code</th><th>Expires</th></tr></thead><tbody>${resets
          .map(
            (r) =>
              `<tr><td>${person(r.full_name, `${r.role === 'mechanic' ? 'Mechanic' : 'Car owner'} · ${r.email}`, `/admin/users/${r.id}`)}</td><td>${r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : '—'}</td>
<td><span class="code">${esc(r.code_hint)}</span></td><td>${esc(fmtDateTime(r.expires_at))}<br><span class="muted small">in ${Math.max(1, Math.round((r.expires_at.getTime() - Date.now()) / 60_000))} min</span></td></tr>`,
          )
          .join('')}</tbody></table></div>`
      : empty('No reset requests', 'When someone taps "Forgot password" in an app, their code appears here.')
  }</section>
<section class="card"><div class="card-b"><h2>How to hand out a code safely</h2><ol class="muted" style="margin:8px 0 0;padding-left:20px">
<li>Only give a code to someone who calls you. Never send it to a number they dictate.</li>
<li>Call them back on the phone number saved on the account, and confirm their full name and email.</li>
<li>Read the code out. They type it in the app and choose a new password.</li></ol></div></section>`;
  res.send(page({ title: 'Password resets', active: '/admin/resets', counts, maintenance, notice: str(req.query.notice), body, refreshSeconds: 20, subtitle: 'People locked out of their account, until an SMS provider sends codes automatically.' }));
});

// ── Settings ────────────────────────────────────────────────────────────────────────────────────────

async function settingsMap() {
  const rows = await query<{ key: string; value: string }>(`SELECT key, value FROM system_config`);
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, string | undefined>;
}

const setConfig = (key: string, value: string) =>
  query(`INSERT INTO system_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, value]);

adminRouter.get('/settings', async (req, res) => {
  const { counts, maintenance } = await chrome();
  const s = await settingsMap();
  const fee = await serviceFee();
  const error = str(req.query.error);
  const body = `${error ? `<div class="notice warn" role="alert">${icon('triangle-alert')}${esc(error === 'phone' ? 'Enter the support number with its country code, for example +256 700 123456.' : 'Enter the version as three numbers, for example 1.0.0.')}</div>` : ''}
<div class="grid2"><div>
<section class="card"><div class="card-h"><h2>App settings</h2></div><div class="card-b"><form method="post" action="/admin/settings">
<div class="field"><label for="support_phone">Support phone number</label><input id="support_phone" name="support_phone" value="${esc(s.support_phone ?? '+256700000000')}" inputmode="tel" required>
<span class="hint">Shown in both apps under Help &amp; support, and to people who forget their password.</span></div>
<div class="field"><label for="min_app_version">Minimum app version</label><input id="min_app_version" name="min_app_version" value="${esc(s.min_app_version ?? '1.0.0')}" required pattern="\\d+\\.\\d+\\.\\d+">
<span class="hint">Older apps are asked to update. Leave at 1.0.0 unless an old version must stop working.</span></div>
<div class="field"><label>Service fee</label><p style="margin:0" class="strong">${esc(ugx(fee))} per job</p><span class="hint">Part of the pricing rules; change it with the web platform team.</span></div>
<button class="btn primary">Save settings</button></form></div></section>
</div><div>
<section class="card"><div class="card-h"><h2>Maintenance mode</h2>${maintenance ? pill('On', 'warning') : pill('Off', 'success')}</div><div class="card-b">
<p class="muted" style="margin:0 0 12px">While it is on, both apps show a "We'll be right back" screen and nobody can send SOS requests. Use it only during planned work on the system.</p>
<form method="post" action="/admin/settings/maintenance" data-confirm="${maintenance ? 'Turn maintenance mode off? The apps will work normally again.' : 'Turn maintenance mode on? Nobody can use the apps or send an SOS until you turn it off.'}">
<input type="hidden" name="mode" value="${maintenance ? 'off' : 'on'}"><button class="btn ${maintenance ? 'success' : 'danger'}">${maintenance ? 'Turn maintenance mode off' : 'Turn maintenance mode on'}</button></form></div></section>
<section class="card"><div class="card-b"><h2>Signing in</h2><p class="muted" style="margin:6px 0 0">This console uses the <b>ADMIN_PASSWORD</b> set on Render (mycarrepair-api → Environment). Change it there to change the password; the server restarts with the new one.</p></div></section>
</div></div>`;
  res.send(page({ title: 'Settings', active: '/admin/settings', counts, maintenance, notice: str(req.query.notice), body, subtitle: 'Values the apps read when they start.' }));
});

adminRouter.post('/settings', async (req, res) => {
  const phone = str(req.body?.support_phone).trim();
  const version = str(req.body?.min_app_version).trim();
  if (!/^\+?[0-9][0-9 ]{7,18}$/.test(phone)) return res.redirect(303, '/admin/settings?error=phone');
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version)) return res.redirect(303, '/admin/settings?error=version');
  await setConfig('support_phone', phone.replace(/\s+/g, ' '));
  await setConfig('min_app_version', version);
  res.redirect(303, '/admin/settings?notice=settings');
});

adminRouter.post('/settings/maintenance', async (req, res) => {
  const on = str(req.body?.mode) === 'on';
  await setConfig('maintenance_mode', on ? 'true' : 'false');
  res.redirect(303, `/admin/settings?notice=${on ? 'maintenance-on' : 'maintenance-off'}`);
});
