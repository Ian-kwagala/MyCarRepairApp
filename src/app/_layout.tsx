import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastHost } from '@/components';
import { LockScreen, MaintenanceScreen } from '@/features/app-gates';
import { RealtimeBridge } from '@/features/realtime-bridge';
import { useConfig } from '@/hooks/queries';
import { configureNotifications } from '@/services/notifications';
import { persister, queryClient } from '@/services/query-client';
import { usePrefs } from '@/store/prefs';
import { useSession } from '@/store/session';
import { Palette, useIsDark } from '@/theme';

// Root layout: the app's entry point. Loads fonts, preferences and the saved session, sets up the data
// cache and theme, and decides which part of the app the user may see.

// Keep the splash screen up until fonts and the session are ready.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Wraps the whole app in its providers; shows nothing (the splash screen) until startup finishes. */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });
  const status = useSession((s) => s.status);
  const dark = useIsDark();

  // One-time startup work.
  useEffect(() => {
    void usePrefs.getState().load();
    void useSession.getState().hydrate();
    void configureNotifications();
  }, []);

  // A font error still counts as ready: the app falls back to system fonts rather than hanging.
  const ready = (fontsLoaded || !!fontError) && status !== 'loading';
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  // Navigation theme using the app's colours, so screen transitions don't flash the default white.
  const p = dark ? Palette.dark : Palette.light;
  const base = dark ? DarkTheme : DefaultTheme;
  const navTheme = { ...base, colors: { ...base.colors, background: p.background, card: p.surface, primary: p.primary, text: p.text, border: p.border } };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 24 * 60 * 60_000 }}>
        <SafeAreaProvider>
          <ThemeProvider value={navTheme}>
            <Gate />
            <RealtimeBridge />
            <ToastHost />
          </ThemeProvider>
        </SafeAreaProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}

/** Launch routing (§9): token → role home; pending mechanic → M7; maintenance flag → maintenance screen. */
function Gate() {
  const user = useSession((s) => s.session?.user ?? null);
  const locked = useSession((s) => s.locked);
  const config = useConfig();

  if (config.maintenance) return <MaintenanceScreen onRetry={() => queryClient.invalidateQueries({ queryKey: ['config'] })} />;
  if (user && locked) return <LockScreen />;

  // Each protected group is only reachable when its guard is true; expo-router redirects away otherwise.
  const signedIn = !!user;
  const isOwner = user?.role === 'owner';
  const isMechanic = user?.role === 'mechanic' && user.status === 'active';
  const isPending = user?.role === 'mechanic' && user.status !== 'active';

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Protected guard={isOwner}>
        <Stack.Screen name="(owner)" />
      </Stack.Protected>
      <Stack.Protected guard={isMechanic}>
        <Stack.Screen name="mechanic" />
      </Stack.Protected>
      <Stack.Protected guard={isPending}>
        <Stack.Screen name="verify" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="notifications" />
        <Stack.Screen name="account/edit" />
        <Stack.Screen name="settings" />
      </Stack.Protected>
    </Stack>
  );
}
