import type { AppNotification, RealtimeEvent, RealtimePayload } from '@/models';
import { formatUGX } from '@/utils/format';

import { Keys, kv } from './storage';

type Listener = (userId: number) => void;
const listeners = new Set<Listener>();
const MAX = 100;

export function subscribeNotifications(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function listNotifications(userId: number): Promise<AppNotification[]> {
  return kv.get<AppNotification[]>(Keys.notifications(userId), []);
}

/** Text for the notification centre (O13) — mirrors the push texts in §8. */
export function describeEvent(event: RealtimeEvent, p: RealtimePayload): { title: string; body: string } | null {
  const s = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '');
  if (typeof p.title === 'string' && typeof p.body === 'string') return { title: p.title, body: p.body };
  switch (event) {
    case 'new_job_pushed':
      return { title: p.sos ? `New SOS · ${s('serviceType')}` : `New booking · ${s('serviceType')}`, body: s('summary') || 'Open the job board to respond.' };
    case 'job_taken':
      return { title: 'Mechanic on the way', body: s('summary') || 'A mechanic accepted your request.' };
    case 'job_progress_update':
      return { title: 'Repair update', body: s('summary') || 'Your mechanic has arrived.' };
    case 'task_update':
      return { title: 'Task completed', body: s('summary') || 'Your repair checklist was updated.' };
    case 'new_quote_alert':
      return {
        title: 'Quote needs approval',
        body: `${s('partName') || 'Part'} · ${formatUGX(Number(p.price ?? 0))}`,
      };
    case 'quote_updated':
      return { title: 'Quote decided', body: s('summary') || 'The owner decided on a part quote.' };
    case 'appointment_update':
      return { title: 'Booking update', body: s('summary') || 'Your booking was updated.' };
    case 'job_finished':
      return { title: 'Job complete', body: s('summary') || 'Your receipt is ready.' };
    case 'mechanic_approved':
      return { title: "You're verified", body: 'Go online to start receiving jobs.' };
    default:
      return null;
  }
}

export async function addNotification(userId: number, event: RealtimeEvent, payload: RealtimePayload) {
  const text = describeEvent(event, payload);
  if (!text) return;
  const list = await listNotifications(userId);
  const n: AppNotification = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId,
    event,
    title: text.title,
    body: text.body,
    jobId: typeof payload.jobId === 'number' ? payload.jobId : undefined,
    quoteId: typeof payload.quoteId === 'number' ? payload.quoteId : undefined,
    createdAt: new Date().toISOString(),
    read: false,
  };
  await kv.set(Keys.notifications(userId), [n, ...list].slice(0, MAX));
  listeners.forEach((l) => l(userId));
}

export async function markAllRead(userId: number) {
  const list = await listNotifications(userId);
  await kv.set(
    Keys.notifications(userId),
    list.map((n) => ({ ...n, read: true })),
  );
  listeners.forEach((l) => l(userId));
}

export async function markRead(userId: number, id: string) {
  const list = await listNotifications(userId);
  await kv.set(
    Keys.notifications(userId),
    list.map((n) => (n.id === id ? { ...n, read: true } : n)),
  );
  listeners.forEach((l) => l(userId));
}

export async function clearNotifications(userId: number) {
  await kv.remove(Keys.notifications(userId));
  listeners.forEach((l) => l(userId));
}
