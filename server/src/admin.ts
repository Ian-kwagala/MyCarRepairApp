import { Router, type RequestHandler } from 'express';

import { config } from './config';
import { query, tx } from './db';
import { emitTo } from './realtime';
import type { UserRow } from './types';

/**
 * Minimal operations page (the full admin console stays on the web portal, §1): approve pending mechanics,
 * suspend/reactivate accounts, and read password-reset codes to callers after verifying them.
 * Protected by HTTP Basic auth with ADMIN_PASSWORD; disabled when that variable is unset.
 */
export const adminRouter = Router();

const auth: RequestHandler = (req, res, next) => {
  if (!config.adminPassword) {
    res.status(404).send('Admin page is disabled. Set ADMIN_PASSWORD to enable it.');
    return;
  }
  const [scheme, value] = (req.headers.authorization ?? '').split(' ');
  const [, pass] = scheme === 'Basic' && value ? Buffer.from(value, 'base64').toString().split(':') : [];
  if (pass !== config.adminPassword) {
    res.setHeader('WWW-Authenticate', 'Basic realm="MyCarRepair admin"');
    res.status(401).send('Authentication required.');
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
  next();
};
adminRouter.use(auth);

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

adminRouter.get('/', async (_req, res) => {
  const pending = await query<UserRow>(`SELECT * FROM users WHERE role = 'mechanic' AND status = 'pending' ORDER BY created_at`);
  const people = await query<UserRow>(`SELECT * FROM users WHERE role <> 'admin' AND status <> 'pending' ORDER BY created_at DESC LIMIT 200`);
  const resets = await query<{ full_name: string; email: string; phone: string; code_hint: string; expires_at: Date }>(
    `SELECT u.full_name, u.email, u.phone, p.code_hint, p.expires_at FROM password_resets p JOIN users u ON u.id = p.user_id WHERE p.expires_at > now()`,
  );
  const [counts] = await query<{ owners: string; mechanics: string; open: string; done: string }>(
    `SELECT (SELECT COUNT(*) FROM users WHERE role = 'owner') AS owners, (SELECT COUNT(*) FROM users WHERE role = 'mechanic' AND status = 'active') AS mechanics,
            (SELECT COUNT(*) FROM jobs WHERE status NOT IN ('completed', 'cancelled')) AS open, (SELECT COUNT(*) FROM jobs WHERE status = 'completed') AS done`,
  );
  const btn = (action: string, label: string, color: string) =>
    `<form method="post" action="${action}" style="display:inline"><button style="background:${color}">${label}</button></form>`;
  res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>MyCarRepair admin</title>
<style>body{font-family:system-ui,sans-serif;margin:0;background:#f1f5f9;color:#0f172a}header{background:#0f172a;color:#fff;padding:16px 20px}
main{padding:16px 20px;max-width:1000px}h2{margin-top:28px}table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden}
td,th{padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:left;font-size:14px;vertical-align:top}button{color:#fff;border:0;border-radius:8px;padding:8px 12px;font-weight:600;cursor:pointer}
.stats{display:flex;gap:12px;flex-wrap:wrap}.stat{background:#fff;border-radius:12px;padding:12px 16px}.stat b{font-size:22px;display:block}.muted{color:#64748b}</style></head>
<body><header><b style="color:#F97316">MyCarRepair</b> · operations</header><main>
<div class="stats"><div class="stat"><b>${counts.owners}</b>owners</div><div class="stat"><b>${counts.mechanics}</b>active mechanics</div><div class="stat"><b>${counts.open}</b>open jobs</div><div class="stat"><b>${counts.done}</b>completed jobs</div></div>
<h2>Mechanics waiting for approval (${pending.length})</h2>
${pending.length ? `<table><tr><th>Mechanic</th><th>Garage</th><th>Expertise</th><th></th></tr>${pending
    .map(
      (m) => `<tr><td><b>${esc(m.full_name)}</b><br><span class="muted">${esc(m.email)} · ${esc(m.phone)}<br>signed up ${esc(m.created_at.toISOString().slice(0, 10))}</span></td>
<td>${esc(m.garage_name)}<br><span class="muted">${esc(m.garage_location)}</span></td><td>${esc(m.expertise)}</td>
<td>${btn(`/admin/users/${m.id}/approve`, 'Approve', '#16a34a')} ${btn(`/admin/users/${m.id}/suspend`, 'Reject', '#EF4444')}</td></tr>`,
    )
    .join('')}</table>` : '<p class="muted">Nobody is waiting.</p>'}
<h2>Password reset codes</h2>
<p class="muted">Read a code only to the account holder, after confirming who they are. Codes expire after 15 minutes.</p>
${resets.length ? `<table><tr><th>User</th><th>Code</th><th>Expires</th></tr>${resets.map((r) => `<tr><td>${esc(r.full_name)}<br><span class="muted">${esc(r.email)} · ${esc(r.phone)}</span></td><td><b>${esc(r.code_hint)}</b></td><td>${esc(r.expires_at.toISOString().slice(11, 16))} UTC</td></tr>`).join('')}</table>` : '<p class="muted">No active reset requests.</p>'}
<h2>Accounts</h2>
<table><tr><th>Name</th><th>Role</th><th>Status</th><th></th></tr>${people
    .map(
      (u) => `<tr><td>${esc(u.full_name)}<br><span class="muted">${esc(u.email)} · ${esc(u.phone)}</span></td><td>${esc(u.role)}${u.garage_name ? `<br><span class="muted">${esc(u.garage_name)}</span>` : ''}</td><td>${esc(u.status)}</td>
<td>${u.status === 'suspended' ? btn(`/admin/users/${u.id}/approve`, 'Reactivate', '#1E40AF') : btn(`/admin/users/${u.id}/suspend`, 'Suspend', '#EF4444')}</td></tr>`,
    )
    .join('')}</table></main></body></html>`);
});

adminRouter.post('/users/:id/approve', async (req, res) => {
  const id = Number(req.params.id);
  const [u] = await query<UserRow>(`UPDATE users SET status = 'active' WHERE id = $1 AND role <> 'admin' RETURNING *`, [id]);
  // Push "You're verified — go online" (§8).
  if (u?.role === 'mechanic') emitTo([u.id], 'mechanic_approved', {});
  res.redirect(303, '/admin');
});

adminRouter.post('/users/:id/suspend', async (req, res) => {
  const id = Number(req.params.id);
  await tx(async (db) => {
    await db.query(`UPDATE users SET status = 'suspended', is_online = false WHERE id = $1 AND role <> 'admin'`, [id]);
    await db.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [id]);
  });
  res.redirect(303, '/admin');
});
