import { create } from 'zustand';

/**
 * The API runs on a free plan that sleeps after 15 minutes without traffic and needs up to a minute to wake.
 * `waking` is true while a request to a sleeping server is taking long, so screens can say why they wait.
 */
export const useServerStatus = create<{ waking: boolean }>(() => ({ waking: false }));

export const setServerWaking = (waking: boolean) => {
  if (useServerStatus.getState().waking !== waking) useServerStatus.setState({ waking });
};
