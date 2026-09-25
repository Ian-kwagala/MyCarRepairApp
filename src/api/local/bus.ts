// In-process event bus for local mode. The local store emits events here in place of the server's
// Socket.IO rooms, and LocalRealtime (realtime.ts) delivers them to the signed-in user.
import type { RealtimeEvent, RealtimePayload } from '@/models';
import { addNotification } from '@/services/notification-store';

type Listener = (userId: number, event: RealtimeEvent, payload: RealtimePayload) => void;
const listeners = new Set<Listener>();

/** Subscribes to every event emitted on the bus; returns an unsubscribe function. */
export function listen(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Server-side emit to user_<id> rooms. Events are scoped to their recipients only — owners and
 * mechanics never receive other users' events (§8). Recipients also get a notification-centre entry,
 * standing in for the push the server would send while the app is backgrounded.
 */
export async function emitTo(
  userIds: number[],
  event: RealtimeEvent,
  payload: RealtimePayload,
  opts: { notify?: boolean } = {},
) {
  const unique = [...new Set(userIds)];
  if (opts.notify !== false) {
    await Promise.all(unique.map((id) => addNotification(id, event, payload)));
  }
  for (const id of unique) listeners.forEach((l) => l(id, event, payload));
}
