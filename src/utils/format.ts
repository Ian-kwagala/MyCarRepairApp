// Text formatting helpers: money (Ugandan shillings), dates and times, names, and phone numbers.

/** UGX has no minor unit in practice; format with thousands separators (§5.1). */
export function formatUGX(amount: number | null | undefined, withCurrency = true): string {
  const n = Math.round(Number(amount ?? 0));
  const s = n.toLocaleString('en-US');
  return withCurrency ? `UGX ${s}` : s;
}

/** Short amount for tight spaces like chart labels: 1.25M, 50k, 900. */
export function compactUGX(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (amount >= 1_000) return `${Math.round(amount / 1_000)}k`;
  return String(Math.round(amount));
}

/** Parses "210,000" / "210000" into an integer amount. */
export function parseAmount(text: string): number {
  const n = Number(text.replace(/[^0-9]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Reformats a price as the user types it, adding thousands separators ("210000" → "210,000"). */
export function formatAmountInput(text: string): string {
  const n = parseAmount(text);
  return n ? n.toLocaleString('en-US') : '';
}

const DAY = 24 * 60 * 60 * 1000;

/** Midnight (local time) at the start of the given day. */
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** A date like "5 Mar 2026"; "—" when missing or invalid. */
export function formatDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', opts ?? { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A 24-hour time like "14:05". */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Date and time, like "5 Mar 2026 · 14:05". */
export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} · ${formatTime(iso)}`;
}

/** Relative time like "just now", "5 min ago", "3 h ago", "yesterday", "4 d ago". */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} d ago`;
}

/** Same grouping as the web Activity page: Today … Older. */
export function dateGroup(iso: string): string {
  const today = startOfDay(new Date()).getTime();
  const t = startOfDay(new Date(iso)).getTime();
  const days = Math.round((today - t) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  if (days < 14) return 'Last week';
  if (days < 31) return 'This month';
  return 'Older';
}

/**
 * Splits a list into sections ("Today", "Yesterday", …) for a SectionList. Items must already be sorted
 * newest first; consecutive items in the same group share a section.
 */
export function groupByDate<T>(items: T[], getDate: (t: T) => string): { title: string; data: T[] }[] {
  const out: { title: string; data: T[] }[] = [];
  for (const item of items) {
    const title = dateGroup(getDate(item));
    const last = out[out.length - 1];
    if (last && last.title === title) last.data.push(item);
    else out.push({ title, data: [item] });
  }
  return out;
}

/** "Good morning/afternoon/evening" for the time of day. */
export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** First word of a full name. */
export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? '').trim().split(/\s+/)[0] ?? '';
}

/** Up to two capital initials for an avatar ("Jane Doe" → "JD"); "?" if there's no name. */
export function initials(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** YYYY-MM-DD in local time (not UTC, so late-evening dates don't shift to the next day). */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Puts a phone number into +256… form so the same number always matches: strips spaces and symbols, and
 * turns a local "07…" or bare "256…" into international format. Other inputs are returned as digits.
 */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[^0-9+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('256')) return `+${digits}`;
  if (digits.startsWith('0')) return `+256${digits.slice(1)}`;
  return digits;
}
