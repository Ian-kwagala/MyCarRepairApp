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

interface PresenceState {
  coords: { lat: number; lng: number } | null;
  locationError: string | null;
  setCoords: (f: Fix) => void;
  setError: (e: string | null) => void;
}

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
  const last = useRef(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        const s = await watchPosition((fix) => {
          usePresence.getState().setCoords(fix);
          if (Date.now() - last.current >= LOCATION_INTERVAL_MS - 1000) {
            last.current = Date.now();
            void api.updateLocation(fix).catch(() => undefined);
          }
        }, LOCATION_INTERVAL_MS);
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

let incomingOpen = false;
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
  const seen = useRef<Set<number> | null>(null);
  const pathname = usePathname();
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    void kv.get<number[]>(Keys.seenSos(userId), []).then((ids) => {
      seen.current = new Set(ids);
    });
  }, [userId]);

  const alert = (jobId: number) => {
    if (!userId || !seen.current || seen.current.has(jobId) || incomingOpen) return;
    seen.current.add(jobId);
    void kv.set(Keys.seenSos(userId), [...seen.current].slice(-200));
    router.push(`/mechanic/incoming/${jobId}`);
  };

  useEffect(() => {
    if (!online) return;
    return realtime.on('new_job_pushed', (p) => {
      if (p.sos && typeof p.jobId === 'number') alert(p.jobId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, userId]);

  useEffect(() => {
    if (!online || !sos.data || pathname.startsWith('/mechanic/incoming')) return;
    const next = sos.data.find((j) => !seen.current?.has(j.id));
    if (next) alert(next.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sos.data, online]);
}
