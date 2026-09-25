import { SOS_ISSUES } from '@/constants/config';

import { ICONS, type IconName } from './icons';

/**
 * Server-rendered building blocks for the admin console. Everything is inline (CSS, SVG icons) apart from one
 * same-origin script, so the page works under the default helmet CSP and loads nothing from other hosts.
 */

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const icon = (name: IconName, size = 18) =>
  `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// Kampala time (EAT, UTC+3, no daylight saving), the time staff and users live in.
const EAT_MS = 3 * 3600_000;
const eat = (d: Date) => new Date(d.getTime() + EAT_MS);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (d: Date | null | undefined) => {
  if (!d) return '—';
  const e = eat(d);
  return `${e.getUTCDate()} ${MONTHS[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
};
export const fmtTime = (d: Date) => eat(d).toISOString().slice(11, 16);
export const fmtDateTime = (d: Date | null | undefined) => (d ? `${fmtDate(d)}, ${fmtTime(d)}` : '—');
export const ago = (d: Date) => {
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return fmtDate(d);
};

export const num = (n: number | string) => Number(n).toLocaleString('en-US');
export const ugx = (n: number | string) => `UGX ${num(Math.round(Number(n)))}`;
/** Compact money for stat tiles: UGX 950K, UGX 12.4M. */
export const ugxCompact = (n: number | string) => {
  const v = Number(n);
  if (v >= 1e6) return `UGX ${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (v >= 1e4) return `UGX ${Math.round(v / 1e3)}K`;
  return ugx(v);
};

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';
export const pill = (label: string, tone: Tone = 'neutral') => `<span class="pill ${tone}">${esc(label)}</span>`;

export type JobKind = 'SOS' | 'Booking' | 'Diagnostic';
export function jobKind(j: { sos_active: boolean; service_type: string }): JobKind {
  if (j.sos_active || (SOS_ISSUES as readonly string[]).includes(j.service_type)) return 'SOS';
  if (j.service_type.startsWith('Diagnostic:')) return 'Diagnostic';
  return 'Booking';
}
export const kindPill = (k: JobKind) => pill(k, k === 'SOS' ? 'danger' : k === 'Diagnostic' ? 'info' : 'neutral');

const STATUS: Record<string, [string, Tone]> = {
  pending: ['Waiting for mechanic', 'warning'],
  accepted: ['Mechanic on the way', 'info'],
  diagnosing: ['Diagnosing', 'info'],
  fixing: ['Fixing', 'info'],
  ready: ['Ready', 'info'],
  completed: ['Completed', 'success'],
  cancelled: ['Cancelled', 'neutral'],
};
export const jobStatusPill = (s: string) => pill(...(STATUS[s] ?? [s, 'neutral']));

export const userStatusPill = (s: string) =>
  s === 'active' ? pill('Active', 'success') : s === 'pending' ? pill('Awaiting approval', 'warning') : pill('Suspended', 'danger');

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export const person = (name: string | null, sub?: string | null, href?: string) =>
  name
    ? `<div class="person"><span class="avatar">${esc(initials(name))}</span><div><${href ? `a href="${href}"` : 'span'} class="strong">${esc(name)}</${href ? 'a' : 'span'}>${sub ? `<span class="muted small">${esc(sub)}</span>` : ''}</div></div>`
    : '<span class="muted">—</span>';

export const empty = (title: string, body = '') => `<div class="empty">${icon('circle-check', 28)}<p class="strong">${esc(title)}</p>${body ? `<p class="muted">${esc(body)}</p>` : ''}</div>`;

/** POST button. `confirm` text is shown by admin.js before submitting. */
export const action = (url: string, label: string, back: string, style: 'primary' | 'success' | 'danger' | 'ghost', confirm?: string) =>
  `<form method="post" action="${esc(url)}" class="inline"${confirm ? ` data-confirm="${esc(confirm)}"` : ''}><input type="hidden" name="back" value="${esc(back)}"><button class="btn ${style}">${esc(label)}</button></form>`;

export const mapsLink = (lat: number | null, lng: number | null) =>
  lat != null && lng != null
    ? `<a href="https://www.google.com/maps?q=${Number(lat)},${Number(lng)}" target="_blank" rel="noopener noreferrer">${icon('map-pin', 15)} Open in Google Maps</a>`
    : '<span class="muted">No location</span>';

export const NOTICES: Record<string, string> = {
  approved: 'Mechanic approved. They can go online now.',
  reactivated: 'Account reactivated.',
  suspended: 'Account suspended and signed out on all devices.',
  rejected: 'Application rejected. The account is suspended.',
  settings: 'Settings saved. Apps pick them up the next time they open.',
  'maintenance-on': 'Maintenance mode is on: the apps now show a maintenance screen.',
  'maintenance-off': 'Maintenance mode is off: the apps work normally again.',
};

export interface NavCounts {
  pending: number;
  resets: number;
  openSos: number;
}

const NAV: { href: string; label: string; icon: IconName; badge?: keyof NavCounts }[] = [
  { href: '/admin', label: 'Overview', icon: 'layout-dashboard' },
  { href: '/admin/approvals', label: 'Approvals', icon: 'user-check', badge: 'pending' },
  { href: '/admin/jobs', label: 'Jobs', icon: 'clipboard-list', badge: 'openSos' },
  { href: '/admin/owners', label: 'Car owners', icon: 'car' },
  { href: '/admin/mechanics', label: 'Mechanics', icon: 'wrench' },
  { href: '/admin/resets', label: 'Password resets', icon: 'key-round', badge: 'resets' },
  { href: '/admin/settings', label: 'Settings', icon: 'settings' },
];

export function page(opts: {
  title: string;
  active: string;
  counts: NavCounts;
  body: string;
  subtitle?: string;
  actions?: string;
  back?: { href: string; label: string };
  notice?: string;
  maintenance?: boolean;
  refreshSeconds?: number;
}) {
  const nav = NAV.map((n) => {
    const count = n.badge ? opts.counts[n.badge] : 0;
    const badge = count ? `<span class="badge${n.badge === 'openSos' ? ' red' : ''}">${count}</span>` : '';
    return `<a href="${n.href}" class="nav${opts.active === n.href ? ' on' : ''}"${opts.active === n.href ? ' aria-current="page"' : ''}>${icon(n.icon)}<span>${n.label}</span>${badge}</a>`;
  }).join('');
  const notice = opts.notice && NOTICES[opts.notice] ? `<div class="notice" role="status">${icon('circle-check')}${esc(NOTICES[opts.notice])}</div>` : '';
  const maint = opts.maintenance
    ? `<div class="notice warn" role="status">${icon('triangle-alert')}Maintenance mode is on: both apps show a maintenance screen. <a href="/admin/settings">Turn it off in Settings</a></div>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(opts.title)} · MyCarRepair Admin</title><link rel="icon" href="data:,"><style>${CSS}</style></head>
<body${opts.refreshSeconds ? ` data-refresh="${opts.refreshSeconds}"` : ''}><div class="shell">
<aside class="side"><a class="brand" href="/admin"><span class="logo">${icon('wrench', 20)}</span><span>MyCarRepair<small>Admin console</small></span></a>
<nav aria-label="Admin sections">${nav}</nav>
<p class="side-foot">Kampala time (EAT)<br>Updated ${fmtTime(new Date())}</p></aside>
<main class="main">${opts.back ? `<a class="back" href="${esc(opts.back.href)}">${icon('arrow-left', 16)} ${esc(opts.back.label)}</a>` : ''}
<header class="top"><div><h1>${esc(opts.title)}</h1>${opts.subtitle ? `<p class="muted">${opts.subtitle}</p>` : ''}</div>${opts.actions ? `<div class="top-actions">${opts.actions}</div>` : ''}</header>
${maint}${notice}${opts.body}</main></div><script src="/admin/assets/admin.js"></script></body></html>`;
}

/** Filter chips: links that keep the other query parameters. */
export function chips(base: string, param: string, current: string, options: [string, string][], keep: Record<string, string>) {
  return `<div class="chips" role="group">${options
    .map(([value, label]) => {
      const q = new URLSearchParams({ ...keep, [param]: value });
      for (const [k, v] of [...q]) if (!v) q.delete(k);
      const qs = q.toString();
      return `<a class="chip${current === value ? ' on' : ''}" href="${base}${qs ? `?${qs}` : ''}"${current === value ? ' aria-current="true"' : ''}>${esc(label)}</a>`;
    })
    .join('')}</div>`;
}

export function searchBox(base: string, q: string, placeholder: string, hidden: Record<string, string>) {
  return `<form class="search" method="get" action="${base}" role="search">${icon('search', 16)}<input type="search" name="q" value="${esc(q)}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">${Object.entries(
    hidden,
  )
    .filter(([, v]) => v)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('')}</form>`;
}

export function pager(base: string, pageNo: number, hasMore: boolean, keep: Record<string, string>) {
  if (pageNo === 1 && !hasMore) return '';
  const link = (p: number, label: string) => {
    const q = new URLSearchParams({ ...keep, page: String(p) });
    for (const [k, v] of [...q]) if (!v) q.delete(k);
    return `<a class="btn ghost" href="${base}?${q}">${label}</a>`;
  };
  return `<div class="pager">${pageNo > 1 ? link(pageNo - 1, '← Newer') : '<span></span>'}<span class="muted small">Page ${pageNo}</span>${hasMore ? link(pageNo + 1, 'Older →') : '<span></span>'}</div>`;
}

/**
 * Single-series column chart (jobs per day). Columns ≤ 24 px with 4 px rounded tops, a hairline baseline, the
 * peak labelled directly, native hover tooltips via <title>, and a table view for screen readers.
 */
export function columnChart(rows: { label: string; full: string; value: number }[], unit: string) {
  const W = 640;
  const H = 180;
  const top = 24;
  const bottom = 28;
  const plot = H - top - bottom;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const slot = W / rows.length;
  const bw = Math.min(24, slot * 0.55);
  const peak = rows.reduce((a, r, i) => (r.value > rows[a]!.value ? i : a), 0);
  const bars = rows
    .map((r, i) => {
      const h = r.value ? Math.max(4, (r.value / max) * plot) : 0;
      const x = i * slot + (slot - bw) / 2;
      const y = top + plot - h;
      const rad = Math.min(4, h);
      const d = h
        ? `M${x},${top + plot}V${y + rad}Q${x},${y} ${x + rad},${y}H${x + bw - rad}Q${x + bw},${y} ${x + bw},${y + rad}V${top + plot}Z`
        : '';
      const label = i === peak && r.value ? `<text x="${x + bw / 2}" y="${y - 6}" text-anchor="middle" class="val">${r.value}</text>` : '';
      return `<g class="col"><title>${esc(r.full)}: ${r.value} ${unit}</title><rect x="${i * slot}" y="${top}" width="${slot}" height="${plot}" fill="transparent"/>${d ? `<path d="${d}"/>` : ''}${label}<text x="${i * slot + slot / 2}" y="${H - 8}" text-anchor="middle" class="tick">${esc(r.label)}</text></g>`;
    })
    .join('');
  const table = `<details class="table-view"><summary>Show as table</summary><table class="t"><thead><tr><th>Day</th><th class="num">${esc(unit)}</th></tr></thead><tbody>${rows
    .map((r) => `<tr><td>${esc(r.full)}</td><td class="num">${r.value}</td></tr>`)
    .join('')}</tbody></table></details>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(unit)} per day, last ${rows.length} days"><line x1="0" x2="${W}" y1="${top + plot}" y2="${top + plot}" class="base"/>${bars}</svg>${table}`;
}

const CSS = `
:root{--bg:#f4f6fa;--surface:#fff;--ink:#0f172a;--ink2:#334155;--muted:#64748b;--line:#e5e9f0;--line2:#eef1f5;--navy:#0f172a;--navy2:#1e293b;
--orange:#F97316;--orange-ink:#c2410c;--orange-soft:#fff3ea;--green:#15803d;--green-soft:#e8f6ee;--red:#dc2626;--red-soft:#fdeeee;--amber:#a15c07;--amber-soft:#fff5dc;
--blue:#1d4ed8;--blue-soft:#ebf1ff;--gray-soft:#eef1f5;color-scheme:light}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
.i{flex:none;vertical-align:-3px}
.shell{display:grid;grid-template-columns:248px minmax(0,1fr);min-height:100vh;background:linear-gradient(90deg,var(--navy) 248px,transparent 248px)}
.side{background:var(--navy);color:#cbd5e1;padding:20px 14px;display:flex;flex-direction:column;gap:18px;position:sticky;top:0;height:100vh}
.brand{display:flex;gap:10px;align-items:center;color:#fff;font-weight:700;font-size:16px;padding:4px 8px;text-decoration:none!important}
.brand small{display:block;color:#94a3b8;font-weight:500;font-size:12px}
.logo{width:36px;height:36px;border-radius:10px;background:var(--orange);color:#fff;display:grid;place-items:center}
nav{display:flex;flex-direction:column;gap:2px}
.nav{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;color:#cbd5e1;font-weight:500;text-decoration:none!important}
.nav:hover{background:var(--navy2);color:#fff}.nav.on{background:var(--navy2);color:#fff;box-shadow:inset 3px 0 0 var(--orange)}
.nav span:first-of-type{flex:1}
.badge{background:#334155;color:#fff;border-radius:999px;padding:0 8px;font-size:12px;font-weight:700;line-height:20px}.badge.red{background:var(--red)}
.side-foot{margin:auto 8px 0;font-size:12px;color:#64748b}
.main{padding:28px 32px 48px;min-width:0;max-width:1280px}
.back{display:inline-flex;gap:6px;align-items:center;color:var(--muted);font-weight:500;margin-bottom:8px}
.top{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:20px}
h1{font-size:24px;line-height:1.25;margin:0 0 2px;letter-spacing:-.01em}
h2{font-size:15px;margin:0}
.muted{color:var(--muted)}.small{font-size:12px}.strong{font-weight:600;color:var(--ink)}
.notice{display:flex;gap:10px;align-items:center;background:var(--green-soft);color:var(--green);border:1px solid #cdebd8;padding:10px 14px;border-radius:10px;margin-bottom:16px;font-weight:500}
.notice.warn{background:var(--amber-soft);color:var(--amber);border-color:#f5e0ae}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:20px}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px;display:block;color:inherit;text-decoration:none!important}
a.tile:hover{border-color:#cbd5e1}
.tile .label{color:var(--muted);font-size:13px;font-weight:500}
.tile .value{font-size:26px;font-weight:650;line-height:1.2;margin-top:4px;color:var(--ink)}
.tile .note{font-size:12px;color:var(--muted);margin-top:2px}
.tile.alert{border-color:#f3c4c4}
.tiles.compact{grid-template-columns:repeat(3,minmax(0,1fr))}.tiles.compact .value{font-size:20px;white-space:nowrap}.tile.alert .value{color:var(--red)}
.grid2{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:16px;align-items:start}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;margin-bottom:16px;overflow:hidden}
.card-h{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line2)}
.card-b{padding:16px}
.t{width:100%;border-collapse:collapse}
.t th{font-size:12px;font-weight:600;color:var(--muted);text-align:left;padding:10px 16px;background:#fafbfc;border-bottom:1px solid var(--line);white-space:nowrap}
.t td{padding:12px 16px;border-bottom:1px solid var(--line2);vertical-align:middle}
.t tr:last-child td{border-bottom:0}.t tbody tr:hover td{background:#fafbfd}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.scroll{overflow-x:auto}
.person{display:flex;gap:10px;align-items:center;min-width:0}.person>div{display:flex;flex-direction:column;min-width:0}
.avatar{width:32px;height:32px;border-radius:50%;background:var(--orange-soft);color:var(--orange-ink);display:grid;place-items:center;font-size:12px;font-weight:700;flex:none}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;background:var(--gray-soft);color:var(--ink2)}
.pill.info{background:var(--blue-soft);color:var(--blue)}.pill.success{background:var(--green-soft);color:var(--green)}
.pill.warning{background:var(--amber-soft);color:var(--amber)}.pill.danger{background:var(--red-soft);color:var(--red)}.pill.brand{background:var(--orange-soft);color:var(--orange-ink)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#cbd5e1;margin-right:6px}.dot.on{background:#16a34a}
.btn{display:inline-flex;align-items:center;gap:6px;border:1px solid transparent;border-radius:8px;padding:7px 12px;font:600 13px/1.2 inherit;cursor:pointer;text-decoration:none!important;white-space:nowrap}
.btn.primary{background:var(--navy);color:#fff}.btn.primary:hover{background:var(--navy2)}
.btn.success{background:#16a34a;color:#fff}.btn.success:hover{background:var(--green)}
.btn.danger{background:#fff;color:var(--red);border-color:#f3c4c4}.btn.danger:hover{background:var(--red-soft)}
.btn.ghost{background:#fff;color:var(--ink2);border-color:var(--line)}.btn.ghost:hover{background:#f8fafc}
.btn:focus-visible,.nav:focus-visible,.chip:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--orange);outline-offset:2px}
form.inline{display:inline}.actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.toolbar{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--line2)}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{padding:5px 12px;border-radius:999px;border:1px solid var(--line);background:#fff;color:var(--ink2);font-weight:500;font-size:13px;text-decoration:none!important}
.chip:hover{border-color:#cbd5e1}.chip.on{background:var(--navy);border-color:var(--navy);color:#fff}
.search{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:8px;padding:0 10px;background:#fff;color:var(--muted);min-width:260px}
.search input{border:0;outline:0;padding:8px 0;font:inherit;width:100%;background:transparent;color:var(--ink)}
.pager{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-top:1px solid var(--line2)}
.empty{text-align:center;padding:36px 16px;color:#16a34a}.empty p{margin:6px 0 0}
dl.kv{display:grid;grid-template-columns:max-content 1fr;gap:8px 20px;margin:0}dl.kv dt{color:var(--muted)}dl.kv dd{margin:0;min-width:0;overflow-wrap:anywhere}
.approval{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;padding:16px;border-bottom:1px solid var(--line2);align-items:center}
.approval:last-child{border-bottom:0}.approval .meta{display:flex;gap:18px;flex-wrap:wrap;margin-top:8px;color:var(--ink2)}
.code{font:700 22px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.18em;color:var(--ink)}
.photos{display:flex;gap:8px;flex-wrap:wrap}.photos img{width:88px;height:88px;object-fit:cover;border-radius:8px;border:1px solid var(--line)}
.check{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line2)}.check:last-child{border-bottom:0}
.box{width:18px;height:18px;border-radius:5px;border:2px solid #cbd5e1;flex:none}.box.done{background:#16a34a;border-color:#16a34a}
.field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}.field label{font-weight:600}
.field input{border:1px solid var(--line);border-radius:8px;padding:9px 12px;font:inherit;max-width:360px}
.hint{font-size:12px;color:var(--muted)}
.stars{color:#f59e0b;letter-spacing:1px}
.chart{width:100%;height:auto;display:block}.chart path{fill:var(--orange)}.chart .col:hover path{fill:var(--orange-ink)}
.chart .base{stroke:var(--line);stroke-width:1}.chart .tick{fill:var(--muted);font-size:11px}.chart .val{fill:var(--ink);font-size:12px;font-weight:600}
.table-view{margin-top:8px}.table-view summary{cursor:pointer;color:var(--muted);font-size:12px}.table-view .t{margin-top:8px}
@media (max-width:1000px){.grid2{grid-template-columns:minmax(0,1fr)}}
@media (max-width:860px){.shell{grid-template-columns:minmax(0,1fr);background:none}.side{position:static;height:auto;padding:12px}
nav{flex-direction:row;overflow-x:auto;gap:4px}.nav{white-space:nowrap}.nav.on{box-shadow:inset 0 -3px 0 var(--orange)}.side-foot{display:none}
.main{padding:20px 16px 40px}.tiles,.tiles.compact{grid-template-columns:repeat(2,minmax(0,1fr))}.tile .value{font-size:22px}.search{min-width:0;flex:1}.approval{grid-template-columns:1fr}.actions{justify-content:flex-start}}
`;
