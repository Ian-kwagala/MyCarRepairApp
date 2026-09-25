import type * as Location from 'expo-location';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { create } from 'zustand';

import { api, realtime } from '@/api';
import { LOCATION_INTERVAL_MS } from '@/constants/config';
import { useMechanicJobs } from '@/hooks/queries';
import { getCurrentFix, watchPosition, type Fix } from '@/services/location';
import { Keys, kv } from '@/services/storage';
import { useUser } from '@/store/session';

// Mechanic "presence": tracks and shares the mechanic's GPS position while they're available, and pops
// up the full-screen incoming-SOS alert when a new emergency job arrives for them.

interface PresenceState {
  coords: { lat: number; lng: number } | null;
  locationError: string | null;
  setCoords: (f: Fix) => void;
  setError: (e: string | null) => void;
}

/** The mechanic's latest GPS position and any location error, shared across screens. */
export const usePresence = create<PresenceState>((set) => ({
  coords: null,
  locationError: null,
  setCoords: (f) => set({ coords: { lat: f.lat, lng: f.lng }, locationError: null }),
  setError: (locationError) => set({ locationError }),
}));

/**
 * Push a fresh fix to the server now. Used when going online: SOS dispatch needs the mechanic's
 * position, so a permission denial or GPS failure is rethrown and aborts the status change.
 */
export async function shareLocationOnce() {
  try {
    const fix = await getCurrentFix();
    usePresence.getState().setCoords(fix);
    await api.updateLocation(fix);
  } catch (e) {
    usePresence.getState().setError(e instanceof Error ? e.message : 'Location unavailable');
    throw e;
  }
}

/**
 * While Online (or on an accepted job) and the app is open, the mechanic's position is sent every 15 s
 * (POST /me/location) and relayed to the owner's live map. Stops when offline with no active job
 * (§11, §13.1). Background updates (app closed / screen locked) need a background location task in a
 * development build and are not implemented yet, so the UI only promises sharing while the app is open.
 */
export function useLocationSharing(active: boolean) {
  const sub = useRef<Location.LocationSubscription | null>(null);
  // When the position was last sent to the server.
  const last = useRef(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        const s = await watchPosition((fix) => {
          // Always update the on-screen position; throttle server updates to about one per interval
          // (1 s leeway so a slightly early GPS callback isn't skipped).
          usePresence.getState().setCoords(fix);
          if (Date.now() - last.current >= LOCATION_INTERVAL_MS - 1000) {
            last.current = Date.now();
            void api.updateLocation(fix).catch(() => undefined);
          }
        }, LOCATION_INTERVAL_MS);
        // If sharing was switched off while the watcher was starting, stop it straight away.
        if (cancelled) s.remove();
        else sub.current = s;
      } catch (e) {
        usePresence.getState().setError(e instanceof Error ? e.message : 'Location unavailable');
      }
    })();
    return () => {
      cancelled = true;
      sub.current?.remove();
      sub.current = null;
    };
  }, [active]);
}

// True while the incoming-SOS screen is showing, so a second alert doesn't stack on top of it.
let incomingOpen = false;
/** Called by the incoming-SOS screen when it opens and closes. */
export const setIncomingOpen = (v: boolean) => {
  incomingOpen = v;
};

/**
 * M2 trigger: a new SOS for this mechanic interrupts any screen with the full-screen alert.
 * Driven by the `new_job_pushed` event and, as a safety net, by polling the SOS tab while online.
 */
export function useIncomingSosWatcher() {
  const user = useUser();
  const coords = usePresence((s) => s.coords);
  const online = !!user?.isOnline;
  const sos = useMechanicJobs('sos', coords, { live: online });
  // SOS job IDs already alerted, so each one only interrupts the mechanic once (saved across restarts).
  const seen = useRef<Set<number> | null>(null);
  const pathname = usePathname();
  const userId = user?.id;

  // Load the saved "already alerted" list; alerts wait until it's loaded.
  useEffect(() => {
    if (!userId) return;
    void kv.get<number[]>(Keys.seenSos(userId), []).then((ids) => {
      seen.current = new Set(ids);
    });
  }, [userId]);

  // Opens the full-screen alert for a job not alerted before; remembers the last 200 IDs.
  const alert = (jobId: number) => {
    if (!userId || !seen.current || seen.current.has(jobId) || incomingOpen) return;
    seen.current.add(jobId);
    void kv.set(Keys.seenSos(userId), [...seen.current].slice(-200));
    router.push(`/mechanic/incoming/${jobId}`);
  };

  // Instant path: react to the realtime event.
  useEffect(() => {
    if (!online) return;
    return realtime.on('new_job_pushed', (p) => {
      if (p.sos && typeof p.jobId === 'number') alert(p.jobId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, userId]);

  // Fallback path: an unseen job in the polled SOS list (covers events missed while disconnected).
  useEffect(() => {
    if (!online || !sos.data || pathname.startsWith('/mechanic/incoming')) return;
    const next = sos.data.find((j) => !seen.current?.has(j.id));
    if (next) alert(next.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sos.data, online]);
}
