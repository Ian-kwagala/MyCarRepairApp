import type { ChecklistItem, Job, JobStatus, PartsQuote, Vehicle } from '@/models';
import { SERVICE_FEE, SERVICE_INTERVAL_MONTHS } from '@/constants/config';

export const STAGES = ['Sent', 'Accepted', 'Arrived', 'Fixing', 'Done'] as const;
export type Stage = (typeof STAGES)[number];

/**
 * O9 stage mapping: pending→Sent, accepted→Accepted, fixing (no task yet)→Arrived,
 * fixing (first task ticked)→Fixing, completed→Done.
 */
export function stageIndex(job: Pick<Job, 'status' | 'checklist'>): number {
  switch (job.status) {
    case 'pending':
      return 0;
    case 'accepted':
      return 1;
    case 'diagnosing':
      return 2;
    case 'fixing':
      return (job.checklist ?? []).some((t) => t.isCompleted) ? 3 : 2;
    case 'ready':
      return 3;
    case 'completed':
      return 4;
    case 'cancelled':
      return -1;
  }
}

export const ACTIVE_STATUSES: JobStatus[] = ['pending', 'accepted', 'diagnosing', 'fixing', 'ready'];
export const isActive = (s: JobStatus) => ACTIVE_STATUSES.includes(s);
export const isFinished = (s: JobStatus) => s === 'completed' || s === 'cancelled';

export function statusLabel(status: JobStatus): string {
  switch (status) {
    case 'pending':
      return 'Searching';
    case 'accepted':
      return 'Accepted';
    case 'diagnosing':
      return 'Diagnosing';
    case 'fixing':
      return 'Fixing';
    case 'ready':
      return 'Ready';
    case 'completed':
      return 'Done';
    case 'cancelled':
      return 'Cancelled';
  }
}

export type Tone = 'info' | 'warning' | 'success' | 'danger' | 'neutral' | 'primary';

export function statusTone(status: JobStatus): Tone {
  switch (status) {
    case 'pending':
      return 'warning';
    case 'accepted':
    case 'diagnosing':
      return 'info';
    case 'fixing':
    case 'ready':
      return 'primary';
    case 'completed':
      return 'success';
    case 'cancelled':
      return 'neutral';
  }
}

export function progress(checklist: ChecklistItem[] | undefined) {
  const list = checklist ?? [];
  const done = list.filter((t) => t.isCompleted).length;
  return { done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
}

export function computeTotals(quotes: PartsQuote[] | undefined, serviceFee = SERVICE_FEE) {
  const approvedParts = (quotes ?? []).filter((q) => q.isApproved === true).reduce((s, q) => s + q.price, 0);
  return { serviceFee, approvedParts, total: serviceFee + approvedParts };
}

export function pendingQuotes(job: Pick<Job, 'quotes'>) {
  return (job.quotes ?? []).filter((q) => q.isApproved === null);
}

/** M4 lock rule: finish only when every task is ticked and no quote is pending (§6.4). */
export function canFinish(job: Pick<Job, 'checklist' | 'quotes' | 'status'>) {
  const openTasks = (job.checklist ?? []).filter((t) => !t.isCompleted).length;
  const openQuotes = pendingQuotes(job).length;
  return {
    ok: job.status === 'fixing' && openTasks === 0 && openQuotes === 0 && (job.checklist ?? []).length > 0,
    openTasks,
    openQuotes,
  };
}

export function vehicleLabel(v?: Pick<Vehicle, 'make' | 'model'> | null) {
  return v ? `${v.make} ${v.model}` : 'Vehicle';
}

/** Service due = last_service_date + 6 months. Returns days until due (negative = overdue). */
export function serviceDueInDays(v: Pick<Vehicle, 'lastServiceDate'>): number | null {
  if (!v.lastServiceDate) return null;
  const d = new Date(v.lastServiceDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + SERVICE_INTERVAL_MONTHS);
  return Math.ceil((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

export function serviceDueText(v: Pick<Vehicle, 'lastServiceDate'>): string | null {
  const days = serviceDueInDays(v);
  if (days == null) return null;
  if (days < 0) return `Service overdue by ${-days} d`;
  if (days === 0) return 'Service due today';
  return `Service due in ${days} d`;
}

/** Review quick-tags are prefixed into reviews.feedback text (no schema change). */
export function composeFeedback(tags: string[], comment: string): string | null {
  const parts: string[] = [];
  if (tags.length) parts.push(`[${tags.join(', ')}]`);
  if (comment.trim()) parts.push(comment.trim());
  return parts.length ? parts.join(' ') : null;
}

export function parseFeedback(feedback: string | null): { tags: string[]; comment: string } {
  if (!feedback) return { tags: [], comment: '' };
  const m = feedback.match(/^\[([^\]]*)\]\s*(.*)$/s);
  if (!m) return { tags: [], comment: feedback };
  return { tags: m[1].split(',').map((t) => t.trim()).filter(Boolean), comment: m[2] };
}

export function isSos(job: Pick<Job, 'sosActive' | 'serviceType'>, sosIssues: readonly string[]) {
  return job.sosActive || sosIssues.includes(job.serviceType);
}
