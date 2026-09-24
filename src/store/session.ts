import { create } from 'zustand';

import { api, realtime, type Session } from '@/api';
import { SocketRealtime } from '@/api/realtime';
import { isNetworkError } from '@/api/errors';
import { APP_ROLE } from '@/constants/app-variant';
import type { User } from '@/models';
import { resetQueryCache } from '@/services/query-client';
import { Keys, kv, secure } from '@/services/storage';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface SessionState {
  status: Status;
  session: Session | null;
  /** Biometric app-lock is showing. */
  locked: boolean;
  hydrate: () => Promise<void>;
  signIn: (session: Session) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: User) => void;
  unlock: () => void;
}

async function persist(session: Session | null) {
  if (session) await secure.set(Keys.session, JSON.stringify(session));
  else await secure.remove(Keys.session);
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  session: null,
  locked: false,

  hydrate: async () => {
    let session: Session | null = null;
    try {
      const raw = await secure.get(Keys.session);
      session = raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      session = null;
    }
    if (!session || (APP_ROLE && session.user.role !== APP_ROLE)) {
      if (session) await persist(null);
      set({ status: 'signedOut', session: null });
      return;
    }
    api.setAuth(session);
    try {
      const user = await api.me();
      session = { ...session, user };
      await persist(session);
    } catch (e) {
      // Offline: keep the cached session so cached screens still open (§11.1).
      if (!isNetworkError(e)) {
        api.setAuth(null);
        await persist(null);
        set({ status: 'signedOut', session: null });
        return;
      }
    }
    const prefs = await kv.get<{ biometric?: boolean }>(Keys.prefs, {});
    realtime.connect(session);
    set({ status: 'signedIn', session, locked: !!prefs.biometric });
  },

  signIn: async (session) => {
    await resetQueryCache();
    api.setAuth(session);
    await persist(session);
    realtime.connect(session);
    set({ status: 'signedIn', session, locked: false });
  },

  signOut: async () => {
    realtime.disconnect();
    try {
      const { pushToken } = await kv.get<{ pushToken?: string }>(Keys.prefs, {});
      await api.logout(pushToken ?? null);
    } catch {}
    api.setAuth(null);
    await persist(null);
    await resetQueryCache();
    set({ status: 'signedOut', session: null, locked: false });
  },

  setUser: (user) => {
    const s = get().session;
    if (!s) return;
    const session = { ...s, user };
    void persist(session);
    set({ session });
  },

  unlock: () => set({ locked: false }),
}));

// Token refresh / rejection from the API client.
api.onTokensChanged((tokens) => {
  const { session } = useSession.getState();
  if (!session) return;
  if (!tokens) {
    void useSession.getState().signOut();
    return;
  }
  const next = { ...session, ...tokens };
  void persist(next);
  useSession.setState({ session: next });
  // The socket authenticates with the access token at connect time: reconnect with the new one.
  realtime.connect(next);
});

// An expired token on the socket: any authenticated call refreshes it (401 → /auth/refresh → reconnect above).
if (realtime instanceof SocketRealtime) {
  realtime.onAuthError = () => {
    if (useSession.getState().session) void api.me().catch(() => undefined);
  };
}

export function useUser(): User | null {
  return useSession((s) => s.session?.user ?? null);
}

export function useRequiredUser(): User {
  const u = useUser();
  if (!u) throw new Error('No signed-in user');
  return u;
}
