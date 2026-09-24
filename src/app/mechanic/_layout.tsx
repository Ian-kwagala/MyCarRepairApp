import { Stack } from 'expo-router';

import { useIncomingSosWatcher, useLocationSharing } from '@/features/mechanic-presence';
import { useNotificationSetup } from '@/features/use-notification-setup';
import { useMechanicJobs } from '@/hooks/queries';
import { useUser } from '@/store/session';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function MechanicLayout() {
  const user = useUser();
  const active = useMechanicJobs('active', null);
  const enRoute = (active.data ?? []).some((j) => j.status === 'accepted' || j.status === 'fixing');
  useLocationSharing(!!user?.isOnline || enRoute);
  useIncomingSosWatcher();
  useNotificationSetup();
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="incoming/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }} />
    </Stack>
  );
}
