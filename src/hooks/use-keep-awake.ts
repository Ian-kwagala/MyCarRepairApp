import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';
import { Platform } from 'react-native';

/** Keep the screen on (SOS / mechanic found). No-op on web, where wake locks are unreliable. */
export function useKeepScreenOn(tag: string) {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    activateKeepAwakeAsync(tag).catch(() => undefined);
    return () => {
      try {
        void deactivateKeepAwake(tag);
      } catch {}
    };
  }, [tag]);
}
