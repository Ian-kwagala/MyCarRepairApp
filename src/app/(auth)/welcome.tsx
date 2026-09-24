import { router, useFocusEffect } from 'expo-router';
import { BadgeCheck, CarFront, ClipboardList, ShieldCheck, Siren, Wallet, Wrench } from '@/components/icons';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isLocalMode } from '@/api';
import { Button, Text } from '@/components';
import { APP_ROLE } from '@/constants/app-variant';
import { useStatusBar } from '@/hooks/use-status-bar';
import { Keys, kv } from '@/services/storage';
import { Brand, Space } from '@/theme';

/** A1 Welcome — explain value; choose sign-up or sign-in. */
export default function Welcome() {
  useStatusBar('light');
  // Shown once: returning users go straight to sign-in (only when Welcome itself is on screen,
  // so deep links to /sign-up are not overridden).
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void kv.get(Keys.welcomeSeen, false).then((seen) => {
        if (!active) return;
        if (seen) router.replace('/sign-in');
        else void kv.set(Keys.welcomeSeen, true);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const mechanic = APP_ROLE === 'mechanic';
  const points = mechanic
    ? [
        { icon: Siren, text: 'SOS and booking requests from car owners near you' },
        { icon: ClipboardList, text: 'Digital job cards and photo quotes the owner approves in two taps' },
        { icon: Wallet, text: 'Track your earnings and build your reputation with reviews' },
      ]
    : [
        { icon: Siren, text: 'Emergency SOS to the nearest verified mechanic' },
        { icon: BadgeCheck, text: 'Approve every spare part — photo and price — before it is billed' },
        { icon: ShieldCheck, text: 'Track your repair live, task by task' },
      ];
  const LogoIcon = mechanic ? Wrench : CarFront;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: Brand.navy }]}>
      <View style={styles.hero}>
        <View style={styles.logo}>
          <LogoIcon size={40} color="#fff" strokeWidth={2.25} />
        </View>
        {mechanic ? (
          <Text variant="display" style={{ color: '#fff' }}>
            Jobs near you,{'\n'}
            <Text variant="display" style={{ color: Brand.orange }}>
              every day.
            </Text>
          </Text>
        ) : (
          <Text variant="display" style={{ color: '#fff' }}>
            Trusted{'\n'}Mechanics,{'\n'}
            <Text variant="display" style={{ color: Brand.orange }}>
              Anytime.
            </Text>
          </Text>
        )}
        <Text style={{ color: '#cbd5e1', fontSize: 16, lineHeight: 23 }}>
          {mechanic
            ? 'MCR Mechanic connects verified garages with car owners across Kampala.'
            : 'Emergency help, transparent repairs and approved parts — in your pocket.'}
        </Text>
        <View style={{ gap: Space.md, marginTop: Space.md }}>
          {points.map(({ icon: Icon, text }) => (
            <View key={text} style={styles.point}>
              <Icon size={20} color={Brand.orange} />
              <Text style={{ color: '#e2e8f0', flex: 1 }}>{text}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.actions}>
        <Button title={mechanic ? 'Join as a mechanic' : 'Create account'} onPress={() => router.push('/sign-up')} />
        <Button
          title="I already have an account"
          kind="onDark"
          onPress={() => router.push('/sign-in')}
        />
        {isLocalMode ? (
          <Text variant="caption" center style={{ color: '#94a3b8' }}>
            Local data mode · accounts and jobs are stored on this device until the backend is connected.
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hero: { flex: 1, padding: Space.xl, justifyContent: 'center', gap: Space.lg },
  logo: { width: 72, height: 72, borderRadius: 22, backgroundColor: Brand.orange, alignItems: 'center', justifyContent: 'center' },
  point: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  actions: { padding: Space.lg, gap: Space.sm },
});
