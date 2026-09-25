import type { Server as HttpServer } from 'node:http';

import { Server } from 'socket.io';

import type { RealtimeEvent, RealtimePayload } from '@/models';

import { loadUser, verifyAccessToken } from './auth';
import { config } from './config';
import { sendPush } from './push';

// Real-time events for the apps (Socket.io), with push notifications for users whose app isn't connected.

let io: Server | null = null;
const connected = new Map<number, number>(); // userId → open sockets

/**
 * Socket.io on the same server (§4). The JWT comes in the handshake (auth.token); the server joins the
 * socket to user_<id> itself — no client-chosen rooms — so users never receive other users' events.
 */
export function attachRealtime(server: HttpServer) {
  io = new Server(server, { cors: { origin: config.corsOrigins.includes('*') ? '*' : config.corsOrigins } });
  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: string })?.token;
      if (!token) throw new Error('missing token');
      const user = await loadUser(verifyAccessToken(token));
      if (!user || user.status === 'suspended') throw new Error('not allowed');
      socket.data.userId = user.id;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });
  io.on('connection', (socket) => {
    const id = socket.data.userId as number;
    void socket.join(`user_${id}`);
    connected.set(id, (connected.get(id) ?? 0) + 1);
    socket.on('disconnect', () => {
      const n = (connected.get(id) ?? 1) - 1;
      if (n <= 0) connected.delete(id);
      else connected.set(id, n);
    });
  });
  return io;
}

/** Stops Socket.io and forgets connected users (server shutdown and tests). */
export function closeRealtime() {
  void io?.close();
  io = null;
  connected.clear();
}

/** Text shown in pushes (same wording as the in-app notification centre, §8). */
function pushText(event: RealtimeEvent, p: RealtimePayload): { title: string; body: string; channel: 'sos' | 'jobs' } | null {
  const s = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '');
  switch (event) {
    case 'new_job_pushed':
      return { title: p.sos ? `New SOS · ${s('serviceType')}` : `New booking · ${s('serviceType')}`, body: s('summary'), channel: p.sos ? 'sos' : 'jobs' };
    case 'job_taken':
      return { title: 'Mechanic on the way', body: s('summary'), channel: 'jobs' };
    case 'job_progress_update':
      return { title: 'Repair update', body: s('summary'), channel: 'jobs' };
    case 'new_quote_alert':
      return { title: 'Quote needs approval', body: `${s('partName')} · UGX ${Number(p.price ?? 0).toLocaleString('en-US')}`, channel: 'jobs' };
    case 'quote_updated':
      return { title: 'Quote decided', body: s('summary'), channel: 'jobs' };
    case 'appointment_update':
      return { title: 'Booking update', body: s('summary'), channel: 'jobs' };
    case 'job_finished':
      return { title: 'Job complete', body: s('summary'), channel: 'jobs' };
    case 'mechanic_approved':
      return { title: "You're verified", body: 'Go online to start receiving jobs.', channel: 'jobs' };
    default:
      return null; // task_update, mechanic_location, job_unavailable: in-app only
  }
}

/** In-app route a push opens (same targets as the app's realtime bridge). */
function deepLink(event: RealtimeEvent, p: RealtimePayload): string | undefined {
  if (event === 'mechanic_approved') return '/mechanic';
  if (!p.jobId) return undefined;
  // An SOS opens the full-screen accept/decline screen; a booking opens the job.
  if (event === 'new_job_pushed') return p.sos ? `/mechanic/incoming/${p.jobId}` : `/mechanic/job/${p.jobId}`;
  if (event === 'quote_updated') return `/mechanic/job/${p.jobId}`;
  if (event === 'new_quote_alert' && p.quoteId) return `/quote/${p.quoteId}`;
  if (event === 'job_finished') return `/job/${p.jobId}/receipt`;
  return `/job/${p.jobId}`;
}

/** Emit to user_<id> rooms; users without a live socket get a push instead (§8). */
export function emitTo(userIds: number[], event: RealtimeEvent, payload: RealtimePayload) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  io?.to(ids.map((id) => `user_${id}`)).emit(event, payload);
  const text = pushText(event, payload);
  const offline = ids.filter((id) => !connected.has(id));
  if (text && offline.length) {
    void sendPush(offline, text.title, text.body, { event, jobId: payload.jobId, quoteId: payload.quoteId, url: deepLink(event, payload) }, text.channel);
  }
}
