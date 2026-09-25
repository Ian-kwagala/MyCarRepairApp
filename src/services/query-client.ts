import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/api/errors';

import { Keys } from './storage';

// TanStack Query setup: the shared cache for all server data, saved to device storage so screens
// still show the last known data when offline.

/** The app's single query cache. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data younger than 15 s is reused without refetching.
      staleTime: 15_000,
      gcTime: 24 * 60 * 60_000, // keep for offline viewing (§11.1)
      // Serve cached data first even with no connection, instead of pausing the query.
      networkMode: 'offlineFirst',
      // Retry up to twice, but not on 4xx errors: repeating a rejected request won't help.
      retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
    },
    // Always attempt writes so the user gets an immediate error instead of a silent wait.
    mutations: { networkMode: 'always' },
  },
});

/** Garage, activity and job details open offline (TanStack Query persisted to storage). */
export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: Keys.queryCache, throttleTime: 2000 });

/** Wipes cached data from memory and storage, e.g. on sign-out so the next user can't see it. */
export async function resetQueryCache() {
  queryClient.clear();
  await AsyncStorage.removeItem(Keys.queryCache).catch(() => undefined);
}
