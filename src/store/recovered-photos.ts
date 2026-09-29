// Hand-off for camera photos recovered after Android closed the app: the recovery hook files them under the screen
// (route) that asked, and that screen's PhotoPicker takes them when it shows.
import { create } from 'zustand';

import type { LocalPhoto } from '@/models';

interface RecoveredPhotosState {
  byRoute: Record<string, LocalPhoto[]>;
  /** Files a recovered photo under the route whose PhotoPicker opened the camera. */
  add: (route: string, photo: LocalPhoto) => void;
  /** Removes and returns the photos waiting for a route. */
  take: (route: string) => LocalPhoto[];
}

/** Recovered camera photos waiting for their form (see features/camera-recovery). */
export const useRecoveredPhotos = create<RecoveredPhotosState>((set, get) => ({
  byRoute: {},
  add: (route, photo) => set((s) => ({ byRoute: { ...s.byRoute, [route]: [...(s.byRoute[route] ?? []), photo] } })),
  take: (route) => {
    const photos = get().byRoute[route] ?? [];
    if (photos.length) {
      const next = { ...get().byRoute };
      delete next[route];
      set({ byRoute: next });
    }
    return photos;
  },
}));
