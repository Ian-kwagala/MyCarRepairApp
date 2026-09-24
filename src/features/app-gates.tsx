import * as LocalAuthentication from 'expo-local-authentication';
import { Fingerprint, Wrench } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components';
import { useSession } from '@/store/session';
import { Space, useColors } from '@/theme';

/** Resolves true when unlocked (or when the device has no enrolled biometrics). */
async function authenticate(): Promise<boolean> {
  try {
    const has = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!has || !enrolled) return true;
    const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock MyCarRepair' });
    return res.success;
  } catch {
    return true;
  }
}

/** Biometric app-lock (A2: "Biometric unlock after first login"). */
export function LockScreen() {
  const c = useColors();
  const unlock = useSession((s) => s.unlock);
  const signOut = useSession((s) => s.signOut);
  const name = useSession((s) => s.session?.user.fullName);
  const [error, setError] = useState<string | null>(null);

  const tryUnlock = useCallback(() => {
    authenticate().then((ok) => {
      if (ok) unlock();
      else setError('Not recognised. Try again.');
    });
  }, [unlock]);

  useEffect(() => {
    tryUnlock();
  }, [tryUnlock]);

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.header }]}>
      <View style={styles.center}>
        <View style={[styles.logo, { backgroundColor: c.primary }]}>
          <Wrench size={36} color="#fff" />
        </View>
        <Text variant="title" style={{ color: '#fff' }}>
          Welcome back{name ? `, ${name.split(' ')[0]}` : ''}
        </Text>
        <Text style={{ color: '#cbd5e1' }}>Unlock to continue</Text>
        {error ? <Text tone="danger">{error}</Text> : null}
      </View>
      <View style={{ padding: Space.lg, gap: Space.sm }}>
        <Button title="Use fingerprint / Face ID" icon={Fingerprint} onPress={tryUnlock} />
        <Button title="Sign in with password" kind="onDark" onPress={signOut} />
      </View>
    </SafeAreaView>
  );
}

/** Graceful maintenance screen (NFR06) — driven by the maintenance flag in GET /config. */
export function MaintenanceScreen({ onRetry }: { onRetry: () => void }) {
  const c = useColors();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.header }]}>
      <View style={styles.center}>
        <View style={[styles.logo, { backgroundColor: c.primary }]}>
          <Wrench size={36} color="#fff" />
        </View>
        <Text variant="title" center style={{ color: '#fff' }}>
          We&apos;re tuning things up
        </Text>
        <Text center style={{ color: '#cbd5e1', maxWidth: 300 }}>
          MyCarRepair is under maintenance. For an emergency, call the support line.
        </Text>
      </View>
      <View style={{ padding: Space.lg }}>
        <Button title="Try again" onPress={onRetry} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.md, padding: Space.xl },
  logo: { width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: Space.md },
});
