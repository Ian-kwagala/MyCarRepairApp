// Navigation stack for the mechanic part of the app, plus the background work that runs on every
// mechanic screen.
import { Stack } from 'expo-router';

import { useIncomingSosWatcher, useLocationSharing } from '@/features/mechanic-presence';
import { useNotificationSetup } from '@/features/use-notification-setup';
import { useMechanicJobs } from '@/hooks/queries';
import { useUser } from '@/store/session';

// Deep links still get the tabs underneath, so "back" has somewhere to go.
export const unstable_settings = { initialRouteName: '(tabs)' };

/**
 * Mechanic stack. Shares the mechanic's location while online or heading to/working on a job, watches
 * for incoming SOS jobs, and sets up notifications.
 */
export default function MechanicLayout() {
  const user = useUser();
  const active = useMechanicJobs('active', null);
  // On an accepted or in-progress job, keep sharing location even if the mechanic went offline.
  const enRoute = (active.data ?? []).some((j) => j.status === 'accepted' || j.status === 'fixing');
  useLocationSharing(!!user?.isOnline || enRoute);
  useIncomingSosWatcher();
  useNotificationSetup();
  // The incoming-SOS alert covers the whole screen and must be answered with a button, not a swipe.
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="incoming/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }} />
    </Stack>
  );
}
