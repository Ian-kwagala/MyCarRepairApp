import { CheckCheck } from '@/components/icons';

import { Button, Screen } from '@/components';
import { NotificationList } from '@/features/notification-list';
import { useNotifications } from '@/hooks/use-notifications';
import { markAllRead } from '@/services/notification-store';
import { useUser } from '@/store/session';

// Notification history screen (opened from the bell icon or the Profile tab).

/** O13 Notifications, with a "Mark all read" button while any are unread. */
export default function Notifications() {
  const user = useUser();
  const { items, unread, reload } = useNotifications();
  return (
    <Screen
      back
      title="Notifications"
      onRefresh={reload}
      right={unread && user ? <Button title="Mark all read" icon={CheckCheck} size="sm" kind="ghost" onPress={() => markAllRead(user.id)} /> : null}>
      <NotificationList items={items} />
    </Screen>
  );
}
