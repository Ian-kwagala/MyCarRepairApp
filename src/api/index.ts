import Constants from 'expo-constants';

import { setWebTokenPersistence } from '@/services/storage';

import { LocalApiClient } from './local/client';
import { LocalRealtime, SocketRealtime } from './realtime';
import { RemoteApiClient } from './remote/client';
import type { ApiClient, RealtimeClient } from './types';

export * from './errors';
export type * from './types';

/**
 * Data source selection. The data store has not been chosen yet, so by default the app runs on an
 * empty on-device store that enforces the same rules as the server. Set EXPO_PUBLIC_API_URL
 * (e.g. https://api.mycarrepair.ug/api/v1) to switch to the real backend — no screen changes needed.
 */
function resolveApiUrl(): string | null {
  const candidates: unknown[] = [process.env.EXPO_PUBLIC_API_URL, Constants.expoConfig?.extra?.apiUrl];
  const url = candidates.find((c): c is string => typeof c === 'string' && c.length > 0);
  if (!url) return null;
  // Bearer tokens only travel over TLS; plain http is allowed in development builds only (§13.1).
  if (url.startsWith('https://') || (__DEV__ && url.startsWith('http://'))) return url;
  throw new Error(`EXPO_PUBLIC_API_URL must use https:// (got "${url}")`);
}

const apiUrl = resolveApiUrl();

// Web + remote: keep tokens in memory only. Local mode keeps its whole store in browser storage anyway.
setWebTokenPersistence(!apiUrl);

export const localApi = apiUrl ? null : new LocalApiClient();

export const api: ApiClient = localApi ?? new RemoteApiClient(apiUrl!);

export const realtime: RealtimeClient = apiUrl
  ? new SocketRealtime(new URL(apiUrl).origin)
  : new LocalRealtime();

export const isLocalMode = api.mode === 'local';
