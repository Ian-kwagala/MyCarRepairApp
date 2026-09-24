import { create } from 'zustand';

import { Keys, kv } from '@/services/storage';

export interface Prefs {
  biometric: boolean;
  notifyJobs: boolean;
  notifyReminders: boolean;
  language: 'en';
  pushToken?: string;
}

const defaults: Prefs = { biometric: false, notifyJobs: true, notifyReminders: true, language: 'en' };

interface PrefsState extends Prefs {
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Prefs>) => Promise<void>;
}

export const usePrefs = create<PrefsState>((set, get) => ({
  ...defaults,
  loaded: false,
  load: async () => {
    const saved = await kv.get<Partial<Prefs>>(Keys.prefs, {});
    set({ ...defaults, ...saved, loaded: true });
  },
  update: async (patch) => {
    set(patch);
    const { loaded: _l, load: _a, update: _b, ...rest } = { ...get(), ...patch };
    await kv.set(Keys.prefs, rest);
  },
}));
