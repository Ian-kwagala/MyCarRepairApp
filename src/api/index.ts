import Constants from 'expo-constants';

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
  const url = candidates.find((c): c is string => typeof c === 'string' && /^https?:\/\//.test(c));
  return url ?? null;
}

const apiUrl = resolveApiUrl();

export const localApi = apiUrl ? null : new LocalApiClient();

export const api: ApiClient = localApi ?? new RemoteApiClient(apiUrl!);

export const realtime: RealtimeClient = apiUrl
  ? new SocketRealtime(new URL(apiUrl).origin)
  : new LocalRealtime();

export const isLocalMode = api.mode === 'local';
