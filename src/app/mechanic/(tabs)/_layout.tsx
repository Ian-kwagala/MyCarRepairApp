import { Tabs } from 'expo-router';
import { Bell, Briefcase, UserRound, Wallet } from 'lucide-react-native';

import { useNotifications } from '@/hooks/use-notifications';
import { Font, useColors } from '@/theme';

// Bottom tab bar for mechanics.

/** Mechanic tabs: Jobs · Earnings · Alerts · Profile (§9). The Alerts tab shows the unread-notification count. */
export default function MechanicTabs() {
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
      <Tabs.Screen name="index" options={{ title: 'Jobs', tabBarIcon: ({ color }) => <Briefcase color={color} size={24} /> }} />
      <Tabs.Screen name="earnings" options={{ title: 'Earnings', tabBarIcon: ({ color }) => <Wallet color={color} size={24} /> }} />
      <Tabs.Screen name="alerts" options={{ title: 'Alerts', tabBarIcon: ({ color }) => <Bell color={color} size={24} />, tabBarBadge: unread ? unread : undefined }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => <UserRound color={color} size={24} /> }} />
    </Tabs>
  );
}
