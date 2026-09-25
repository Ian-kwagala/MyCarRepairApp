// The in-app notification centre: a per-user list of past events saved on the device, with the text
// shown for each event type, read/unread tracking, and change listeners so badges and lists refresh.
import type { AppNotification, RealtimeEvent, RealtimePayload } from '@/models';
import { formatUGX } from '@/utils/format';

import { Keys, kv } from './storage';

type Listener = (userId: number) => void;
const listeners = new Set<Listener>();
// Only the newest 100 notifications are kept per user.
const MAX = 100;

/** Calls `fn` with the user ID whenever that user's notification list changes; returns an unsubscribe function. */
export function subscribeNotifications(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** A user's saved notifications, newest first. */
export async function listNotifications(userId: number): Promise<AppNotification[]> {
  return kv.get<AppNotification[]>(Keys.notifications(userId), []);
}

/** Text for the notification centre (O13) — mirrors the push texts in §8. */
export function describeEvent(event: RealtimeEvent, p: RealtimePayload): { title: string; body: string } | null {
  // Reads a string field from the payload, or '' if it's missing or not a string.
  const s = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '');
  // Server-supplied text wins over the built-in wording.
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

/** Saves a new unread notification for an event at the top of the user's list. */
export async function addNotification(userId: number, event: RealtimeEvent, payload: RealtimePayload) {
  const text = describeEvent(event, payload);
  // Events with no user-facing text (e.g. live location) aren't stored.
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

/** Marks every notification for the user as read. */
export async function markAllRead(userId: number) {
  const list = await listNotifications(userId);
  await kv.set(
    Keys.notifications(userId),
    list.map((n) => ({ ...n, read: true })),
  );
  listeners.forEach((l) => l(userId));
}

/** Marks one notification as read. */
export async function markRead(userId: number, id: string) {
  const list = await listNotifications(userId);
  await kv.set(
    Keys.notifications(userId),
    list.map((n) => (n.id === id ? { ...n, read: true } : n)),
  );
  listeners.forEach((l) => l(userId));
}

/** Deletes all of the user's notifications. */
export async function clearNotifications(userId: number) {
  await kv.remove(Keys.notifications(userId));
  listeners.forEach((l) => l(userId));
}
