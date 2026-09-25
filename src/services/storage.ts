// Device storage wrappers: `secure` for secrets like tokens, `kv` for everything else, and `Keys`, the
// list of every storage key the app uses.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Web has no secure store. With a real backend, web tokens stay in memory only (sign in again after a
 * reload) so an XSS cannot read them from localStorage. The local data mode keeps its entire store in
 * browser storage anyway, so its session is persisted there too.
 */
let webPersist = false;
const webMemory = new Map<string, string>();

/** Web only: whether `secure` saves to localStorage (true) or keeps values in memory (false). */
export function setWebTokenPersistence(persist: boolean) {
  webPersist = persist;
}

/** Tokens only in SecureStore (Keychain/Keystore) — never AsyncStorage (§13.1). */
export const secure = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      if (!webPersist) return webMemory.get(key) ?? null;
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      if (!webPersist) {
        webMemory.set(key, value);
        return;
      }
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {
        // Storage blocked or full (e.g. private browsing): the session just won't survive a reload.
      }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      // Clear both places, whichever mode was in use.
      webMemory.delete(key);
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {
        // Storage unavailable: nothing was saved there.
      }
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

/** Non-sensitive key/value storage (caches, preferences, notification history). */
export const kv = {
  /** Reads and JSON-parses a value; returns `fallback` if it's missing or unreadable. */
  async get<T>(key: string, fallback: T): Promise<T> {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  /** Saves a value as JSON. Failures are ignored: this data is only a cache or preference. */
  async set(key: string, value: unknown): Promise<void> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
  /** Deletes a value; failures are ignored. */
  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch {}
  },
};

/** Every storage key the app uses. Per-user keys are functions of the user ID; ".v1" marks the data format version. */
export const Keys = {
  session: 'mcr.session.v1',
  prefs: 'mcr.prefs.v1',
  welcomeSeen: 'mcr.welcome-seen',
  notifications: (userId: number) => `mcr.notifications.${userId}`,
  sosQueue: 'mcr.sos-queue.v1',
  skippedJobs: (userId: number) => `mcr.skipped-jobs.${userId}`,
  seenSos: (userId: number) => `mcr.seen-sos.${userId}`,
  queryCache: 'mcr.query-cache.v1',
  localDb: 'mcr.localdb.v1',
} as const;
