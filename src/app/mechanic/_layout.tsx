// Navigation stack for the mechanic part of the app, plus the background work that runs on every
// mechanic screen.
import { Stack } from 'expo-router';

import { useIncomingSosWatcher, useLocationSharing } from '@/features/mechanic-presence';
import { useBookingReminders } from '@/features/booking-reminders';
import { useNotificationSetup } from '@/features/use-notification-setup';
import { useMechanicJobs } from '@/hooks/queries';
import { useUser } from '@/store/session';
import { isUpcomingBooking } from '@/utils/jobs';

// Deep links still get the tabs underneath, so "back" has somewhere to go.
export const unstable_settings = { initialRouteName: '(tabs)' };

/**
 * Mechanic stack. Shares the mechanic's location while online or heading to/working on a job, watches
 * for incoming SOS jobs, sets up notifications, and keeps booking reminders scheduled on the phone.
 */
export default function MechanicLayout() {
  const user = useUser();
  const active = useMechanicJobs('active', null);
  // Keep sharing location, even offline, while heading to or working at an SOS/diagnostic car, or on the day of a
  // booking pickup. Other bookings stay quiet: the car comes to the garage, and an upcoming one isn't tracked.
  const enRoute = (active.data ?? []).some((j) =>
    j.scheduledDate
      ? j.status === 'accepted' && j.handover?.mode === 'pickup' && !isUpcomingBooking(j)
      : j.status === 'accepted' || j.status === 'fixing',
  );
  useLocationSharing(!!user?.isOnline || enRoute);
  useIncomingSosWatcher();
  useNotificationSetup();
  useBookingReminders(active.data, 'mechanic');
  // The incoming-SOS alert covers the whole screen and must be answered with a button, not a swipe.
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="incoming/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }} />
    </Stack>
  );
}
