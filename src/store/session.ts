import { create } from 'zustand';

import { api, realtime, type Session } from '@/api';
import { SocketRealtime } from '@/api/realtime';
import { isNetworkError } from '@/api/errors';
import { APP_ROLE } from '@/constants/app-variant';
import type { User } from '@/models';
import { resetQueryCache } from '@/services/query-client';
import { Keys, kv, secure } from '@/services/storage';

// Who is signed in. Restores the saved session at startup, handles sign-in and sign-out, and keeps the
// API client, realtime connection and saved copy in sync with it.

/** 'loading' until the saved session has been checked at startup. */
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

/** Saves the session to secure storage, or deletes it when null. */
async function persist(session: Session | null) {
  if (session) await secure.set(Keys.session, JSON.stringify(session));
  else await secure.remove(Keys.session);
}

/** Hook for the current session and the sign-in/sign-out actions. */
export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  session: null,
  locked: false,

  // Startup: restore the saved session, check it's still valid, and lock the app if biometrics are on.
  hydrate: async () => {
    let session: Session | null = null;
    try {
      const raw = await secure.get(Keys.session);
      session = raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      session = null;
    }
    // A session for the wrong role (e.g. an owner account in the mechanic app) is discarded.
    if (!session || (APP_ROLE && session.user.role !== APP_ROLE)) {
      if (session) await persist(null);
      set({ status: 'signedOut', session: null });
      return;
    }
    api.setAuth(session);
    // Refresh the user's profile (status or details may have changed since last time).
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

  // After a successful login/register: clear the previous user's cached data, then save and connect.
  signIn: async (session) => {
    await resetQueryCache();
    api.setAuth(session);
    await persist(session);
    realtime.connect(session);
    set({ status: 'signedIn', session, locked: false });
  },

  // Tell the server (best effort, so it works offline), then clear everything stored for this user.
  signOut: async () => {
    realtime.disconnect();
    try {
      const { pushToken } = await kv.get<{ pushToken?: string }>(Keys.prefs, {});
      await api.logout(pushToken ?? null);
    } catch {
      // Offline or token already invalid: still sign out locally.
    }
    api.setAuth(null);
    await persist(null);
    await resetQueryCache();
    set({ status: 'signedOut', session: null, locked: false });
  },

  // Replaces the signed-in user's details (e.g. after editing the profile).
  setUser: (user) => {
    const s = get().session;
    if (!s) return;
    const session = { ...s, user };
    void persist(session);
    set({ session });
  },

  // Called once biometric unlock succeeds.
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

<<<<<<< HEAD
/** The signed-in user, or null. */
=======
// An expired token on the socket: any authenticated call refreshes it (401 → /auth/refresh → reconnect above).
if (realtime instanceof SocketRealtime) {
  realtime.onAuthError = () => {
    if (useSession.getState().session) void api.me().catch(() => undefined);
  };
}

>>>>>>> a87e91d6465fdf63b3c8aa1b095f0cccde0d5e54
export function useUser(): User | null {
  return useSession((s) => s.session?.user ?? null);
}

/** The signed-in user, for screens that are only reachable when signed in. Throws if there is none. */
export function useRequiredUser(): User {
  const u = useUser();
  if (!u) throw new Error('No signed-in user');
  return u;
}
