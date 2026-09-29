// Yes/no confirmation dialog and a camera-or-gallery chooser that work on phones and web.
import { Alert, Platform } from 'react-native';

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

/**
 * Asks where a photo should come from. Resolves 'camera', 'library', or null if dismissed. On web there is no
 * choice to make (the browser opens its own file picker), so it resolves 'library' straight away.
 */
export function choosePhotoSource(title: string): Promise<'camera' | 'library' | null> {
  if (Platform.OS === 'web') return Promise.resolve('library');
  return new Promise((resolve) => {
    Alert.alert(title, 'Take a new photo, or choose one you already took.', [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      { text: 'Gallery', onPress: () => resolve('library') },
      { text: 'Camera', onPress: () => resolve('camera') },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
}
