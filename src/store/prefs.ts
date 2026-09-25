// User preferences (app lock, notifications, language), kept in a Zustand store and saved on the device.
import { create } from 'zustand';

import { Keys, kv } from '@/services/storage';

/** Saved user preferences. */
export interface Prefs {
  /** Require fingerprint/Face ID when the app opens. */
  biometric: boolean;
  /** Show system notifications for job updates. */
  notifyJobs: boolean;
  language: 'en';
  /** This device's push token, remembered so sign-out can unregister it. */
  pushToken?: string;
}

// Used until saved preferences have loaded, and for any preference not saved yet.
const defaults: Prefs = { biometric: false, notifyJobs: true, language: 'en' };

interface PrefsState extends Prefs {
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Prefs>) => Promise<void>;
}

/** Hook for reading and changing preferences. Call `load()` once at startup. */
export const usePrefs = create<PrefsState>((set, get) => ({
  ...defaults,
  loaded: false,
  // Reads saved preferences from storage, filling gaps with defaults.
  load: async () => {
    const saved = await kv.get<Partial<Prefs>>(Keys.prefs, {});
    set({ ...defaults, ...saved, loaded: true });
  },
  // Applies changes right away, then saves only the preference fields (not the store's functions/flags).
  update: async (patch) => {
    set(patch);
    const { loaded: _l, load: _a, update: _b, ...rest } = { ...get(), ...patch };
    await kv.set(Keys.prefs, rest);
  },
}));
