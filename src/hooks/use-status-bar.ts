import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle, type StatusBarStyle } from 'expo-status-bar';
import { useCallback, useEffect } from 'react';

/**
 * Status-bar text colour for the focused screen: 'light' on navy headers, 'auto' (follows the theme)
 * on canvas screens. Set on focus so going back restores the right style.
 */
export function useStatusBar(style: StatusBarStyle) {
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(style);
    }, [style]),
  );
}

/** Same, for full-screen gates rendered outside the navigator (lock, maintenance). */
export function useStatusBarOutsideNavigator(style: StatusBarStyle) {
  useEffect(() => {
    setStatusBarStyle(style);
  }, [style]);
}
