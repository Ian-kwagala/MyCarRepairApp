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
      } catch {}
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      webMemory.delete(key);
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {}
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

/** Non-sensitive key/value storage (caches, preferences, notification history). */
export const kv = {
  async get<T>(key: string, fallback: T): Promise<T> {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch {}
  },
};

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
