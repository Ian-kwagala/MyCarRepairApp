import { create } from 'zustand';

// Tiny store for the API server's wake-up state, set by the remote API client and shown by the offline banner.

/**
 * The API runs on a free plan that sleeps after 15 minutes without traffic and needs up to a minute to wake.
 * `waking` is true while a request to a sleeping server is taking long, so screens can say why they wait.
 */
export const useServerStatus = create<{ waking: boolean }>(() => ({ waking: false }));

/** Sets `waking`, skipping the store update (and re-renders) when the value doesn't change. */
export const setServerWaking = (waking: boolean) => {
  if (useServerStatus.getState().waking !== waking) useServerStatus.setState({ waking });
};
