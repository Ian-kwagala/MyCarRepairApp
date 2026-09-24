import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/api/errors';

import { Keys } from './storage';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 24 * 60 * 60_000, // keep for offline viewing (§11.1)
      networkMode: 'offlineFirst',
      retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
    },
    mutations: { networkMode: 'always' },
  },
});

/** Garage, activity and job details open offline (TanStack Query persisted to storage). */
export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: Keys.queryCache, throttleTime: 2000 });

export async function resetQueryCache() {
  queryClient.clear();
  await AsyncStorage.removeItem(Keys.queryCache).catch(() => undefined);
}
