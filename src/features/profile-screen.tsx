import { router } from 'expo-router';
import { Bell, ChevronRight, LifeBuoy, LogOut, Pencil, Settings, Star, Wrench } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Avatar, Card, Divider, ListRow, Row, Screen, StatusPill, Text } from '@/components';
import { useConfig } from '@/hooks/queries';
import { useNotifications } from '@/hooks/use-notifications';
import { callPhone } from '@/services/location';
import { useSession, useUser } from '@/store/session';
import { Space, useColors } from '@/theme';
import { confirm } from '@/utils/confirm';
import { formatDate } from '@/utils/format';

// Shared Profile tab, used by both the owner and mechanic apps.

/**
 * Profile tab for both roles: account, notifications, settings, help, sign out (logout lives here, §10.1).
 * Mechanics also see their garage details and reviews. `children` is shown under the account card for
 * role-specific extras.
 */
export function ProfileScreen({ children }: { children?: ReactNode }) {
  const c = useColors();
  const user = useUser();
  const signOut = useSession((s) => s.signOut);
  const config = useConfig();
  const { unread } = useNotifications();
  if (!user) return null;
  const mechanic = user.role === 'mechanic';

  const chevron = <ChevronRight size={20} color={c.textSubtle} />;
  return (
    <Screen title="Profile" inTabs>
      <Card>
        <Row gap={Space.md}>
          <Avatar name={user.fullName} size={56} />
          <View style={{ flex: 1 }}>
            <Text variant="heading">{user.fullName}</Text>
            <Text variant="caption">{user.email}</Text>
            <Text variant="caption">{user.phone}</Text>
          </View>
          <StatusPill label={mechanic ? 'Mechanic' : 'Car owner'} tone={mechanic ? 'info' : 'primary'} />
        </Row>
        {mechanic ? (
          <>
            <Divider />
            <View style={{ gap: 2, marginTop: Space.sm }}>
              <Row gap={6}>
                <Wrench size={16} color={c.textMuted} />
                <Text variant="bodyStrong">{user.garageName || 'Garage name not set'}</Text>
              </Row>
              <Text variant="caption">{user.garageLocation || 'Location not set'}</Text>
              {user.expertise ? <Text variant="caption">Expertise: {user.expertise}</Text> : null}
            </View>
          </>
        ) : null}
        <Text variant="caption" style={{ marginTop: Space.sm }}>
          Member since {formatDate(user.createdAt, { month: 'long', year: 'numeric' })}
        </Text>
      </Card>

      {children}

      <Card style={{ paddingVertical: Space.xs }}>
        <ListRow icon={Pencil} title="Edit profile" subtitle={mechanic ? 'Name, phone, garage & expertise' : 'Name and phone'} onPress={() => router.push('/account/edit')} right={chevron} />
        <ListRow
          icon={Bell}
          title="Notifications"
          subtitle={unread ? `${unread} unread` : 'All caught up'}
          onPress={() => router.push('/notifications')}
          right={unread ? <StatusPill label={String(unread)} tone="danger" /> : chevron}
        />
        {mechanic ? <ListRow icon={Star} title="My reviews" subtitle="What owners say about your work" onPress={() => router.push('/mechanic/reviews')} right={chevron} /> : null}
        <ListRow icon={Settings} title="Settings" subtitle="Security, alerts, privacy" onPress={() => router.push('/settings')} right={chevron} />
        <ListRow icon={LifeBuoy} title="Help & support" subtitle={config.supportPhone} onPress={() => callPhone(config.supportPhone)} right={chevron} />
      </Card>

      <Card style={{ paddingVertical: Space.xs }}>
        <ListRow
          icon={LogOut}
          title="Sign out"
          danger
          onPress={async () => {
            if (await confirm('Sign out?', mechanic ? 'You will go offline and stop receiving jobs.' : 'You can sign back in any time.', 'Sign out', true)) {
              await signOut();
            }
          }}
        />
      </Card>
      <Text variant="caption" center>
        MyCarRepair v1.0 · Kampala, Uganda
      </Text>
    </Screen>
  );
}
