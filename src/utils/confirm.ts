// Yes/no confirmation dialog, a camera-or-gallery chooser, and the photo/video/gallery chooser for job-step proof,
// all working on phones and web.
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

/** Where job-step proof comes from: a new photo, a new short video, or something already in the gallery. */
export type ProofSource = 'photo' | 'video' | 'library';

/**
 * Asks how to prove a job step: take a photo, record a short video, or pick from the gallery. Resolves null if
 * dismissed. Android dialogs hold at most three buttons, so there is no Cancel button: tapping outside or Back
 * cancels. On web the browser's file picker (photos and videos) opens straight away.
 */
export function chooseProofSource(title: string, maxSeconds: number): Promise<ProofSource | null> {
  if (Platform.OS === 'web') return Promise.resolve('library');
  return new Promise((resolve) => {
    Alert.alert(title, `Show the work: a photo, or a video of up to ${maxSeconds} seconds.`, [
      { text: 'Gallery', onPress: () => resolve('library') },
      { text: 'Video', onPress: () => resolve('video') },
      { text: 'Photo', onPress: () => resolve('photo') },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
}
