import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** Tokens only in SecureStore (Keychain/Keystore) — never AsyncStorage (§13.1). */
export const secure = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
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
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {}
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
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
