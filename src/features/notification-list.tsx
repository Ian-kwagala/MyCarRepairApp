import { router } from 'expo-router';
import { BadgeCheck, Bell, Calendar, Car, CircleCheck, Package, Siren, ThumbsUp, Wrench, type LucideIcon } from '@/components/icons';
import { Pressable, View } from 'react-native';

import { EmptyState, Row, Section, Text } from '@/components';
import type { AppNotification, RealtimeEvent } from '@/models';
import { markRead } from '@/services/notification-store';
import { useUser } from '@/store/session';
import { Radius, Space, useColors } from '@/theme';
import { groupByDate, timeAgo } from '@/utils/format';

import { linkFor } from './realtime-bridge';

// The notification history list, grouped by day, shared by the owner and mechanic notification screens.

// Icon per event type; anything not listed uses the calendar icon.
const ICONS: Partial<Record<RealtimeEvent, LucideIcon>> = {
  new_job_pushed: Siren,
  job_taken: Car,
  job_progress_update: Car,
  task_update: CircleCheck,
  new_quote_alert: Package,
  quote_updated: Package,
  appointment_update: ThumbsUp,
  job_finished: Wrench,
  mechanic_approved: BadgeCheck,
};

/**
 * O13 Notification centre — history with deep links. Unread items are tinted and show a dot; tapping one
 * marks it read and opens the related screen.
 */
export function NotificationList({ items }: { items: AppNotification[] }) {
  const c = useColors();
  const user = useUser();
  if (!items.length) {
    return <EmptyState icon={Bell} title="No notifications yet" body="Job alerts, quotes and updates will appear here." />;
  }
  return (
    <>
      {groupByDate(items, (n) => n.createdAt).map((g, gi) => (
        <Section key={g.title} title={g.title} style={gi === 0 ? { marginTop: 0 } : undefined}>
          {g.data.map((n) => {
            const Icon = ICONS[n.event] ?? Calendar;
            const href = user ? linkFor(user.role, n.event, n) : null;
            return (
              <Pressable
                key={n.id}
                accessibilityRole="button"
                accessibilityLabel={`${n.read ? '' : 'Unread. '}${n.title}. ${n.body}`}
                onPress={() => {
                  if (user) void markRead(user.id, n.id);
                  if (href) router.push(href);
                }}
                style={({ pressed }) => ({
                  backgroundColor: n.read ? c.surface : c.infoSoft,
                  borderRadius: Radius.card,
                  padding: Space.md,
                  opacity: pressed ? 0.85 : 1,
                })}>
                <Row gap={Space.md} style={{ alignItems: 'flex-start' }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={20} color={n.event === 'new_job_pushed' ? c.danger : c.primary} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="bodyStrong">{n.title}</Text>
                    <Text tone="textMuted">{n.body}</Text>
                    <Text variant="caption">{timeAgo(n.createdAt)}</Text>
                  </View>
                  {!n.read ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.primary, marginTop: 6 }} /> : null}
                </Row>
              </Pressable>
            );
          })}
        </Section>
      ))}
    </>
  );
}
