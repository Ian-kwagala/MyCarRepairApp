// Theme entry point: re-exports the design tokens and provides hooks that pick light or dark colours
// from the phone's system setting.
import { useColorScheme } from 'react-native';

import { Palette, type Colors } from './tokens';

export * from './tokens';

/** Returns the colour palette matching the device's current light/dark mode. */
export function useColors(): Colors {
  const scheme = useColorScheme();
  return scheme === 'dark' ? Palette.dark : Palette.light;
}

/** True when the device is in dark mode. */
export function useIsDark() {
  return useColorScheme() === 'dark';
}
