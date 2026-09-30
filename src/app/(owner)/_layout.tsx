// Navigation stack for the car-owner part of the app: the tabs plus the screens pushed on top of them.
import { Stack } from 'expo-router';

import { useBookingReminders } from '@/features/booking-reminders';
import { useNotificationSetup } from '@/features/use-notification-setup';
import { useSosQueueProcessor } from '@/features/use-sos-queue';
import { useJobs } from '@/hooks/queries';

// Deep links still get the tabs underneath, so "back" has somewhere to go.
export const unstable_settings = { initialRouteName: '(tabs)' };

/**
 * Owner stack. Also sets up notifications, sends any SOS queued while offline, and keeps booking reminders
 * (the evening before and the morning of each accepted booking) scheduled on the phone.
 */
export default function OwnerLayout() {
  useNotificationSetup();
  useSosQueueProcessor();
  const active = useJobs('active');
  useBookingReminders(active.data, 'owner');
  // Quotes slide up as a modal; the live SOS screen can't be swiped away by accident.
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="quote/[id]" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="sos/[id]" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
