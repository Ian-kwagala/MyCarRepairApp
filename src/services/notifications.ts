import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import { api } from '@/api';

let configured = false;

/** Android channels (§8): sos (max, full-screen), jobs (high), general (default). */
export async function configureNotifications() {
  if (configured || Platform.OS === 'web') return;
  configured = true;
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

/** Registers the Expo push token with the backend (POST /me/push-token). Needs a dev/production build. */
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice || api.mode !== 'remote') return null;
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.registerPushToken(data, Platform.OS);
    return data;
  } catch {
    return null;
  }
}

/** Shows a system notification when the app is in the background (socket still alive). */
export async function presentIfBackground(title: string, body: string, data: Record<string, unknown>, channel: 'sos' | 'jobs' = 'jobs') {
  if (Platform.OS === 'web' || AppState.currentState === 'active') return;
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data, sound: 'default' },
      trigger: Platform.OS === 'android' ? { channelId: channel } : null,
    });
  } catch {}
}
