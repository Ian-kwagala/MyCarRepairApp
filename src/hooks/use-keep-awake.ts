import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';
import { Platform } from 'react-native';

// Stops the phone screen from sleeping while an urgent screen is showing.

/**
 * Keep the screen on (SOS / mechanic found). No-op on web, where wake locks are unreliable.
 * `tag` identifies this screen's lock so releasing it doesn't affect other screens.
 */
export function useKeepScreenOn(tag: string) {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    activateKeepAwakeAsync(tag).catch(() => undefined);
    // Let the screen sleep again when this screen closes.
    return () => {
      try {
        void deactivateKeepAwake(tag);
      } catch {
        // Nothing to release (activation may have failed).
      }
    };
  }, [tag]);
}
