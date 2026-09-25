import * as LocalAuthentication from 'expo-local-authentication';
import { Bell, Fingerprint, Globe, Shield, Trash2, UserX } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Linking, Platform, Switch } from 'react-native';

import { localApi } from '@/api';
import { Card, ListRow, Screen, Section, Text } from '@/components';
import { useConfig } from '@/hooks/queries';
import { clearNotifications } from '@/services/notification-store';
import { resetQueryCache } from '@/services/query-client';
import { usePrefs } from '@/store/prefs';
import { useSession, useUser } from '@/store/session';
import { toast } from '@/store/toast';
import { Brand, Space } from '@/theme';
import { confirm } from '@/utils/confirm';

// App settings screen (both roles).

/** Settings — biometrics, notification preferences, language, privacy & account deletion (§13.2). */
export default function Settings() {
  const user = useUser();
  const prefs = usePrefs();
  const signOut = useSession((s) => s.signOut);
  const config = useConfig();
  const [bioAvailable, setBioAvailable] = useState(false);

  // Biometric unlock is only offered if the phone has a sensor with a fingerprint/face enrolled.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void (async () => {
      setBioAvailable((await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync()));
    })();
  }, []);

  // Turning biometric unlock on requires a successful scan first, so it can't be enabled by mistake.
  const toggleBio = async (v: boolean) => {
    if (v) {
      const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Confirm to enable quick unlock' });
      if (!res.success) return;
    }
    await prefs.update({ biometric: v });
  };

  // Builds an orange on/off switch for a settings row.
  const sw = (value: boolean, onChange: (v: boolean) => void, disabled?: boolean) => (
    <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: Brand.orange }} thumbColor="#fff" />
  );

  return (
    <Screen back title="Settings">
      <Section title="Security" style={{ marginTop: 0 }}>
        <Card style={{ paddingVertical: Space.xs }}>
          <ListRow
            icon={Fingerprint}
            title="Fingerprint / Face ID unlock"
            subtitle={bioAvailable ? 'Ask for biometrics when the app opens' : 'Not available on this device'}
            right={sw(prefs.biometric, toggleBio, !bioAvailable)}
          />
        </Card>
      </Section>
      <Section title="Notifications">
        <Card style={{ paddingVertical: Space.xs }}>
          <ListRow
            icon={Bell}
            title={user?.role === 'mechanic' ? 'Job alerts' : 'Repair updates'}
            subtitle="Pop-ups and phone notifications for quotes, arrivals and completion. History stays in Notifications."
            right={sw(prefs.notifyJobs, (v) => prefs.update({ notifyJobs: v }))}
          />
          {Platform.OS !== 'web' ? <ListRow icon={Shield} title="System notification settings" onPress={() => Linking.openSettings()} /> : null}
        </Card>
      </Section>
      <Section title="Language">
        <Card style={{ paddingVertical: Space.xs }}>
          <ListRow icon={Globe} title="English" subtitle="Luganda and Swahili coming soon" />
        </Card>
      </Section>
      <Section title="Privacy">
        <Card style={{ gap: Space.sm }}>
          <Text variant="bodyStrong">Your data</Text>
          <Text tone="textMuted">
            MyCarRepair follows Uganda&apos;s Data Protection and Privacy Act, 2019. Your phone number and exact location are shared only with the mechanic or owner on an accepted job,
            and location sharing stops when the job completes.
          </Text>
        </Card>
        <Card style={{ paddingVertical: Space.xs }}>
          <ListRow
            icon={UserX}
            title="Delete my account"
            subtitle="Request deletion of your account and data"
            danger
            onPress={async () => {
              if (await confirm('Delete account?', `We will call you from ${config.supportPhone} to confirm and delete your account and data.`, 'Request deletion', true)) {
                void Linking.openURL(`mailto:privacy@mycarrepair.ug?subject=Account%20deletion%20request&body=Please%20delete%20account%20${encodeURIComponent(user?.email ?? '')}`);
              }
            }}
          />
        </Card>
      </Section>
      {localApi ? (
        <Section title="Local data mode">
          <Card style={{ paddingVertical: Space.xs }}>
            <ListRow
              icon={Trash2}
              title="Erase all local data"
              subtitle="Deletes every account, car and job stored on this device"
              danger
              onPress={async () => {
                if (!(await confirm('Erase local data?', 'All accounts, cars and jobs on this device will be deleted.', 'Erase', true))) return;
                if (user) await clearNotifications(user.id);
                await localApi!.devWipe();
                await resetQueryCache();
                await signOut();
                toast({ title: 'Local data erased', tone: 'info' });
              }}
            />
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
