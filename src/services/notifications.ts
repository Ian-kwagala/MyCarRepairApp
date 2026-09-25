// System (OS-level) notifications: Android channels, the permission prompt, registering for push, and
// showing a local notification when an event arrives while the app is in the background.
// None of this runs on web.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import { api } from '@/api';

// Setup only needs to run once per app launch.
let configured = false;

/** Android channels (§8): sos (max, full-screen), jobs (high), general (default). */
export async function configureNotifications() {
  if (configured || Platform.OS === 'web') return;
  configured = true;
  // Show notifications even while the app is open.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('sos', {
      name: 'SOS alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 250, 500, 250, 500],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
      sound: 'default',
    });
    await Notifications.setNotificationChannelAsync('jobs', {
      name: 'Job updates',
      importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync('general', {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

/** Asked after sign-in with a pre-prompt explaining SOS alerts (§11). */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  await configureNotifications();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const res = await Notifications.requestPermissionsAsync();
  return res.granted;
}

/**
 * The token the server pushes to: the native FCM token on Android builds that include google-services.json (the
 * server sends through Firebase directly), otherwise an Expo push token when the build has an EAS project.
 */
async function pushToken(): Promise<string | null> {
  if (Platform.OS === 'android' && Constants.expoConfig?.extra?.fcm) {
    const { data } = await Notifications.getDevicePushTokenAsync();
    return typeof data === 'string' ? data : null;
  }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

/** Registers this phone's push token with the backend (POST /me/push-token). Needs a dev/production build. */
export async function registerForPush(): Promise<string | null> {
  // Push needs a real device and a backend to send from; skip on web, simulators and local mode.
  if (Platform.OS === 'web' || !Device.isDevice || api.mode !== 'remote') return null;
  try {
    const token = await pushToken();
    if (!token) return null;
    await api.registerPushToken(token, Platform.OS);
    return token;
  } catch {
    return null;
  }
}

/** Firebase rotates tokens now and then; re-register so alerts keep arriving. */
export function onPushTokenChange(listener: (token: string) => void) {
  if (Platform.OS !== 'android' || !Constants.expoConfig?.extra?.fcm) return () => {};
  const sub = Notifications.addPushTokenListener(({ data }) => {
    if (typeof data === 'string') listener(data);
  });
  return () => sub.remove();
}

/** Shows a system notification when the app is in the background (socket still alive). */
export async function presentIfBackground(title: string, body: string, data: Record<string, unknown>, channel: 'sos' | 'jobs' = 'jobs') {
  // In the foreground the screens update live, so no system notification is needed.
  if (Platform.OS === 'web' || AppState.currentState === 'active') return;
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data, sound: 'default' },
      // null trigger = show now; on Android the channel picks the sound and priority.
      trigger: Platform.OS === 'android' ? { channelId: channel } : null,
    });
  } catch {
    // A missed background alert shouldn't crash anything; the in-app list still has the event.
  }
}
