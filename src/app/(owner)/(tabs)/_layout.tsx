// Bottom tab bar for car owners.
import { Tabs } from 'expo-router';
import { useEffect } from 'react';

import { Activity, House, ShoppingBag, UserRound } from '@/components/icons';
import { useNotifications } from '@/hooks/use-notifications';
import { useCart, useCartCount } from '@/store/cart';
import { useUser } from '@/store/session';
import { Font, useColors } from '@/theme';

/**
 * Owner tabs: Home · Shop · Activity · Profile (§9). The garage opens from Home and Profile. The Shop tab shows how
 * many items are in the cart; the Profile tab shows the unread-notification count.
 */
export default function OwnerTabs() {
  const c = useColors();
  const { unread } = useNotifications();
  const user = useUser();
  const loadCart = useCart((s) => s.load);
  const inCart = useCartCount();

  // Load the saved cart at start-up so the Shop tab badge is right before the shop is opened.
  useEffect(() => {
    if (user) void loadCart(user.id);
  }, [user, loadCart]);
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
      <Tabs.Screen
        name="shop"
        options={{ title: 'Shop', tabBarIcon: ({ color }) => <ShoppingBag color={color} size={24} />, tabBarBadge: inCart ? inCart : undefined }}
      />
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
