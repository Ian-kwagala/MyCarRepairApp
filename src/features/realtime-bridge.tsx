import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { api, isLocalMode, realtime } from '@/api';
import { qk } from '@/hooks/queries';
import type { Job, RealtimeEvent, RealtimePayload } from '@/models';
import { addNotification, describeEvent } from '@/services/notification-store';
import { presentIfBackground } from '@/services/notifications';
import { queryClient } from '@/services/query-client';
import { usePrefs } from '@/store/prefs';
import { useSession } from '@/store/session';
import { toast } from '@/store/toast';

/** Deep-link target for an event (§8). */
export function linkFor(role: 'owner' | 'mechanic' | 'admin', event: RealtimeEvent, p: { jobId?: number; quoteId?: number }): Href | null {
  if (event === 'mechanic_approved') return '/mechanic';
  if (!p.jobId) return null;
  if (role === 'mechanic') return `/mechanic/job/${p.jobId}`;
  if (event === 'new_quote_alert' && p.quoteId) return `/quote/${p.quoteId}`;
  if (event === 'job_finished') return `/job/${p.jobId}/receipt`;
  return `/job/${p.jobId}`;
}

const TOAST_EVENTS: RealtimeEvent[] = [
  'job_taken',
  'job_progress_update',
  'new_quote_alert',
  'quote_updated',
  'appointment_update',
  'job_finished',
  'mechanic_approved',
];

function invalidateFor(event: RealtimeEvent, p: RealtimePayload) {
  if (event === 'mechanic_location' && p.jobId && typeof p.lat === 'number' && typeof p.lng === 'number') {
    // Live map only — patch the cached job instead of refetching every 15 s.
    queryClient.setQueryData<Job>(qk.job(p.jobId), (j) =>
      j?.mechanic ? { ...j, mechanic: { ...j.mechanic, locationLat: p.lat as number, locationLng: p.lng as number } } : j,
    );
    return;
  }
  if (p.jobId) void queryClient.invalidateQueries({ queryKey: qk.job(p.jobId) });
  void queryClient.invalidateQueries({ queryKey: ['jobs'] });
  void queryClient.invalidateQueries({ queryKey: ['mechanic'] });
  void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
}

/**
 * Listens to the user's real-time events: refreshes cached data, shows in-app toasts that deep-link,
 * records the notification centre (remote mode — local mode records on the "server" side), and
 * raises a system notification if the app is backgrounded. Also routes notification taps.
 */
export function RealtimeBridge() {
  const user = useSession((s) => s.session?.user);
  const userId = user?.id;
  const role = user?.role;

  useEffect(() => {
    if (!userId || !role) return;
    return realtime.onAny((event, payload) => {
      invalidateFor(event, payload);
      if (!isLocalMode) void addNotification(userId, event, payload);

      if (event === 'mechanic_approved') {
        void api.me().then((u) => useSession.getState().setUser(u));
      }
      const text = describeEvent(event, payload);
      const href = linkFor(role, event, payload);
      // "Job alerts" off → no pop-ups or system notifications (history stays in the notification centre).
      if (!usePrefs.getState().notifyJobs) return;
      if (text && TOAST_EVENTS.includes(event)) {
        toast({
          title: text.title,
          body: text.body,
          tone: event === 'job_finished' || event === 'mechanic_approved' ? 'success' : event === 'new_quote_alert' ? 'warning' : 'info',
          onPress: href ? () => router.push(href) : undefined,
        });
        void presentIfBackground(text.title, text.body, { url: href ?? undefined });
      }
      if (event === 'new_job_pushed' && text) {
        void presentIfBackground(text.title, text.body, { url: href ?? undefined }, payload.sos ? 'sos' : 'jobs');
      }
    });
  }, [userId, role]);

  // Push / local notification tap → deep link, including the tap that launched the app from closed.
  const lastTap = Notifications.useLastNotificationResponse();
  const handledTap = useRef<string | null>(null);
  useEffect(() => {
    if (Platform.OS === 'web' || !userId || !lastTap || lastTap.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = lastTap.notification.request.identifier;
    if (handledTap.current === id) return;
    handledTap.current = id;
    const url = lastTap.notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) router.push(url as Href);
  }, [lastTap, userId]);

  return null;
}
