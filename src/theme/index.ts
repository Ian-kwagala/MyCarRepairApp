import { useColorScheme } from 'react-native';

import { Palette, type Colors } from './tokens';

export * from './tokens';

export function useColors(): Colors {
  const scheme = useColorScheme();
  return scheme === 'dark' ? Palette.dark : Palette.light;
}

export function useIsDark() {
  return useColorScheme() === 'dark';
}
