import { Tabs } from 'expo-router';
import { Activity, House, UserRound } from '@/components/icons';

import { useNotifications } from '@/hooks/use-notifications';
import { Font, useColors } from '@/theme';

<<<<<<< HEAD
// Bottom tab bar for car owners.

/** Owner tabs: Home · Garage · Activity · Profile (§9). The Profile tab shows the unread-notification count. */
=======
/** Owner tabs: Home · Activity · Profile. The garage opens from Home and Profile. */
>>>>>>> a87e91d6465fdf63b3c8aa1b095f0cccde0d5e54
export default function OwnerTabs() {
  const c = useColors();
  const { unread } = useNotifications();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, height: 64, paddingTop: 6 },
        tabBarLabelStyle: { fontFamily: Font.semibold, fontSize: 12, paddingBottom: 4 },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color }) => <House color={color} size={24} /> }} />
      <Tabs.Screen name="activity" options={{ title: 'Activity', tabBarIcon: ({ color }) => <Activity color={color} size={24} /> }} />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <UserRound color={color} size={24} />,
          tabBarBadge: unread ? unread : undefined,
        }}
      />
    </Tabs>
  );
}
