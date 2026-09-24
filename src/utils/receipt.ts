import type { Job } from '@/models';

import { formatDateTime, formatUGX } from './format';
import { computeTotals } from './jobs';

const esc = (s: string | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Receipt layout (the server renders the same content with PDFKit). */
export function receiptHtml(job: Job, serviceFee: number): string {
  const totals = job.totals ?? computeTotals(job.quotes, serviceFee);
  const approved = (job.quotes ?? []).filter((q) => q.isApproved === true);
  const declined = (job.quotes ?? []).filter((q) => q.isApproved === false);
  const tasks = job.checklist ?? [];
  const v = job.vehicle;
  return `<!doctype html><html><head><meta charset="utf-8"/>
<style>
body{font-family:-apple-system,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;margin:32px;font-size:13px}
h1{font-size:22px;margin:0}.brand{color:#F97316}.muted{color:#64748b}
.head{display:flex;justify-content:space-between;border-bottom:3px solid #0f172a;padding-bottom:12px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;margin:8px 0 16px}td,th{padding:6px 4px;border-bottom:1px solid #e2e8f0;text-align:left}
th{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#64748b}.r{text-align:right}
.total td{font-weight:700;font-size:16px;border-top:2px solid #0f172a}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin:16px 0 4px}
</style></head><body>
<div class="head"><div><h1><span class="brand">&#128295;</span> MyCarRepair</h1><div class="muted">Trusted mechanics, anytime, anywhere · Kampala</div></div>
<div class="r"><b>RECEIPT</b><br/>Job #${job.id}<br/><span class="muted">${esc(formatDateTime(job.updatedAt))}</span></div></div>
<table><tr><th>Service</th><td>${esc(job.serviceType)}${job.sosActive ? ' (SOS)' : ''}</td></tr>
<tr><th>Vehicle</th><td>${esc(v ? `${v.make} ${v.model} ${v.year} · ${v.plateNumber}` : '—')}</td></tr>
<tr><th>Mechanic</th><td>${esc(job.mechanic ? `${job.mechanic.fullName}${job.mechanic.garageName ? ` · ${job.mechanic.garageName}` : ''}` : '—')}</td></tr>
<tr><th>Customer</th><td>${esc(job.owner?.fullName ?? '')}</td></tr></table>
<h2>Charges</h2>
<table><tr><th>Item</th><th class="r">Amount</th></tr>
<tr><td>Service fee</td><td class="r">${formatUGX(totals.serviceFee)}</td></tr>
${approved.map((q) => `<tr><td>${esc(q.partName)} <span class="muted">(approved part)</span></td><td class="r">${formatUGX(q.price)}</td></tr>`).join('')}
<tr class="total"><td>Total</td><td class="r">${formatUGX(totals.total)}</td></tr></table>
${declined.length ? `<h2>Declined quotes (not billed)</h2><table>${declined.map((q) => `<tr><td>${esc(q.partName)}</td><td class="r muted">${formatUGX(q.price)}</td></tr>`).join('')}</table>` : ''}
${tasks.length ? `<h2>Work completed</h2><table>${tasks.map((t) => `<tr><td>${t.isCompleted ? '&#10003;' : '&#9744;'} ${esc(t.taskDescription)}</td></tr>`).join('')}</table>` : ''}
<p class="muted">Every part on this receipt was approved by the vehicle owner before billing.</p>
</body></html>`;
}
