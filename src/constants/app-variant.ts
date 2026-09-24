import Constants from 'expo-constants';

/** Set by APP_VARIANT at build time (app.config.ts). null = development build with both roles. */
export const APP_ROLE: 'owner' | 'mechanic' | null = (() => {
  const r = Constants.expoConfig?.extra?.appRole;
  return r === 'owner' || r === 'mechanic' ? r : null;
})();

export const APP_NAME: string = Constants.expoConfig?.name ?? 'MyCarRepair';
