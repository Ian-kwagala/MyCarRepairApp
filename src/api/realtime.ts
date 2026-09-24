/**
 * Real-time events (§8). Same event names as the web platform.
 * - Remote: socket.io with the JWT in the handshake (`auth.token`); the server joins rooms itself.
 * - Local: in-process bus fed by the LocalApiClient.
 */
import { io, type Socket } from 'socket.io-client';

import type { RealtimeEvent, RealtimePayload } from '@/models';

import { listen } from './local/bus';
import type { RealtimeClient, RealtimeHandler, Session } from './types';

export const EVENTS: RealtimeEvent[] = [
  'new_job_pushed',
  'job_unavailable',
  'job_taken',
  'mechanic_location',
  'job_progress_update',
  'task_update',
  'new_quote_alert',
  'quote_updated',
  'appointment_update',
  'job_finished',
  'mechanic_approved',
];

type AnyHandler = (event: RealtimeEvent, payload: RealtimePayload) => void;

abstract class BaseRealtime implements RealtimeClient {
  protected handlers = new Map<RealtimeEvent, Set<RealtimeHandler>>();
  protected anyHandlers = new Set<AnyHandler>();

  abstract connect(session: Session): void;
  abstract disconnect(): void;

  on(event: RealtimeEvent, handler: RealtimeHandler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  onAny(handler: AnyHandler) {
    this.anyHandlers.add(handler);
    return () => {
      this.anyHandlers.delete(handler);
    };
  }

  protected dispatch(event: RealtimeEvent, payload: RealtimePayload) {
    this.handlers.get(event)?.forEach((h) => h(payload ?? {}));
    this.anyHandlers.forEach((h) => h(event, payload ?? {}));
  }
}

export class LocalRealtime extends BaseRealtime {
  private off: (() => void) | null = null;

  connect(session: Session) {
    this.disconnect();
    const me = session.user.id;
    this.off = listen((userId, event, payload) => {
      if (userId === me) this.dispatch(event, payload);
    });
  }

  disconnect() {
    this.off?.();
    this.off = null;
  }
}

export class SocketRealtime extends BaseRealtime {
  private socket: Socket | null = null;
  private reconnectHandlers = new Set<() => void>();

  constructor(private url: string) {
    super();
  }

  connect(session: Session) {
    this.disconnect();
    if (!session.accessToken) return;
    const socket = io(this.url, {
      transports: ['websocket'],
      auth: { token: session.accessToken },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 15000, // exponential reconnect (§11.1)
    });
    for (const ev of EVENTS) socket.on(ev, (payload: RealtimePayload) => this.dispatch(ev, payload));
    // On reconnect the app re-fetches the active job.
    socket.io.on('reconnect', () => this.reconnectHandlers.forEach((h) => h()));
    this.socket = socket;
  }

  onReconnect(fn: () => void) {
    this.reconnectHandlers.add(fn);
    return () => {
      this.reconnectHandlers.delete(fn);
    };
  }

  disconnect() {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
  }
}
