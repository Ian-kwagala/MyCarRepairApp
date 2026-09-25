// Which app variant this build is (owner app, mechanic app, or the dev build with both), read from the
// values app.config.ts baked into the build.
import Constants from 'expo-constants';

/** Set by APP_VARIANT at build time (app.config.ts). null = development build with both roles. */
export const APP_ROLE: 'owner' | 'mechanic' | null = (() => {
  const r = Constants.expoConfig?.extra?.appRole;
  return r === 'owner' || r === 'mechanic' ? r : null;
})();

/** Display name of this build, e.g. "MyCarRepair" or "MCR Mechanic". */
export const APP_NAME: string = Constants.expoConfig?.name ?? 'MyCarRepair';
