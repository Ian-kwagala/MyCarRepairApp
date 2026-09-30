// Booking reminders, scheduled on the phone itself: an accepted booking stays quiet until the evening before its
// day (6 pm) and that morning (7 am), when both the owner and the mechanic get a reminder that says how the car
// changes hands. Scheduling locally means the reminders arrive on time even while the free server sleeps.
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import type { Job } from '@/models';
import { reminderTimes } from '@/utils/jobs';

// Every reminder this feature schedules has an identifier starting with this, so they can be replaced safely
// without touching other scheduled notifications.
const PREFIX = 'booking-reminder-';

/** The reminder text for one booking and one moment ("eve" = the evening before, "day" = that morning). */
function reminderText(job: Job, role: 'owner' | 'mechanic', when: 'eve' | 'day'): { title: string; body: string } {
  const service = job.serviceType;
  const car = job.vehicle ? `${job.vehicle.make} ${job.vehicle.model}` : 'the car';
  const h = job.handover;
  const title = when === 'eve' ? `Tomorrow: ${service}` : `Today: ${service}`;
  if (role === 'owner') {
    const garage = job.mechanic?.garageName || job.mechanic?.fullName || 'the garage';
    const where = job.mechanic?.garageLocation ? ` (${job.mechanic.garageLocation})` : '';
    const body = !h
      ? `Tell ${garage} how ${car} gets there: open the booking to choose drop-off or pickup.`
      : h.mode === 'drop_off'
        ? `Bring ${car} to ${garage}${where}.`
        : `${job.mechanic?.fullName ?? 'Your mechanic'} collects ${car} from ${h.pickupAddress ?? 'your address'}.`;
    return { title, body };
  }
  const owner = job.owner?.fullName ?? 'The owner';
  const body = !h
    ? `${owner} hasn't chosen drop-off or pickup yet. Call them to arrange it.`
    : h.mode === 'drop_off'
      ? `${owner} brings ${car} to your garage.`
      : `Collect ${car} from ${h.pickupAddress ?? "the owner's address"}.`;
  return { title, body };
}

/**
 * Replaces this app's booking reminders with ones for `jobs` (accepted bookings only; past times are skipped).
 * Idempotent: call it whenever the job list changes. Cancelled, started or finished bookings lose their reminders.
 */
export async function syncBookingReminders(jobs: Job[], role: 'owner' | 'mechanic') {
  if (Platform.OS === 'web') return;
  const now = Date.now();
  const wanted: { id: string; date: Date; title: string; body: string; url: string }[] = [];
  for (const job of jobs) {
    if (job.sosActive || job.status !== 'accepted' || !job.scheduledDate) continue;
    const times = reminderTimes(job.scheduledDate);
    for (const when of ['eve', 'day'] as const) {
      const date = times[when];
      if (date.getTime() <= now) continue;
      wanted.push({
        id: `${PREFIX}${job.id}-${when}`,
        date,
        ...reminderText(job, role, when),
        url: role === 'owner' ? `/job/${job.id}` : `/mechanic/job/${job.id}`,
      });
    }
  }
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if (n.identifier.startsWith(PREFIX)) await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
    for (const r of wanted) {
      await Notifications.scheduleNotificationAsync({
        identifier: r.id,
        content: { title: r.title, body: r.body, data: { url: r.url } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.date, channelId: 'jobs' },
      });
    }
  } catch {
    // Reminders are a convenience; never let scheduling problems (e.g. notifications turned off) break a screen.
  }
}

/**
 * Keeps the phone's booking reminders in step with the user's active jobs (the owner's or the mechanic's list).
 * Runs whenever the list is refetched.
 */
export function useBookingReminders(jobs: Job[] | undefined, role: 'owner' | 'mechanic') {
  useEffect(() => {
    if (jobs) void syncBookingReminders(jobs, role);
  }, [jobs, role]);
}
