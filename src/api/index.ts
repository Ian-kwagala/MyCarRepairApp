// Entry point for all data access. Chooses between the on-device local store and the real backend, and
// exports the single `api` and `realtime` clients that every screen and hook uses.
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

/** The local store, exposed for local-only developer tools (wipe data, self-approve); null when using the backend. */
export const localApi = apiUrl ? null : new LocalApiClient();

/** The API client used by the whole app. */
export const api: ApiClient = localApi ?? new RemoteApiClient(apiUrl!);

/** Live event client: Socket.IO against the backend, or an in-process event bus in local mode. */
export const realtime: RealtimeClient = apiUrl
  ? new SocketRealtime(new URL(apiUrl).origin)
  : new LocalRealtime();

/** True when running on the on-device store (no backend configured). */
export const isLocalMode =api.mode === 'local';
