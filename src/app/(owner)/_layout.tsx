import { Stack } from 'expo-router';

import { useNotificationSetup } from '@/features/use-notification-setup';
import { useSosQueueProcessor } from '@/features/use-sos-queue';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function OwnerLayout() {
  useNotificationSetup();
  useSosQueueProcessor();
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="quote/[id]" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="sos/[id]" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
