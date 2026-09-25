import { Alert, Platform } from 'react-native';

// Yes/no confirmation dialog that works on phones and web.

/**
 * Cross-platform confirm dialog (Alert.alert is a no-op on web). Resolves true if the user taps the
 * confirm button, false if they cancel or dismiss it. `destructive` shows the button in red on iOS.
 */
export function confirm(title: string, message: string, confirmText = 'Confirm', destructive = false): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? false);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
