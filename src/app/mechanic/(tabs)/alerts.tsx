import { CheckCheck } from 'lucide-react-native';

import { Button, Screen } from '@/components';
import { NotificationList } from '@/features/notification-list';
import { useNotifications } from '@/hooks/use-notifications';
import { markAllRead } from '@/services/notification-store';
import { useUser } from '@/store/session';

/** Mechanic Alerts tab — SOS alerts, bookings, quote decisions. */
export default function Alerts() {
  const user = useUser();
  const { items, unread, reload } = useNotifications();
  return (
    <Screen
      title="Alerts"
      inTabs
      onRefresh={reload}
      right={unread && user ? <Button title="Mark all read" icon={CheckCheck} size="sm" kind="ghost" onPress={() => markAllRead(user.id)} /> : null}>
      <NotificationList items={items} />
    </Screen>
  );
}
