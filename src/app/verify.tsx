import { Circle, CircleCheck, Clock, LogOut, Phone, ShieldCheck, Upload } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { api, localApi } from '@/api';
import { errorMessage } from '@/api/errors';
import { Button, Card, InlineNotice, Row, Screen, Text } from '@/components';
import { useConfig } from '@/hooks/queries';
import { callPhone } from '@/services/location';
import { useSession, useUser } from '@/store/session';
import { toast } from '@/store/toast';
import { Space, useColors } from '@/theme';
import { firstName } from '@/utils/format';

/** M7 Verification status — holding screen for pending mechanics (status = pending). */
export default function Verify() {
  const c = useColors();
  const user = useUser();
  const setUser = useSession((s) => s.setUser);
  const signOut = useSession((s) => s.signOut);
  const config = useConfig();
  const [checking, setChecking] = useState(false);
  if (!user) return null;

  const suspended = user.status === 'suspended';
  const steps: { label: string; done: boolean; phase2?: boolean }[] = [
    { label: 'Account created', done: true },
    { label: 'Garage & expertise added', done: !!(user.garageName && user.garageLocation) },
    { label: 'National ID / permit photo', done: false, phase2: true },
    { label: 'Admin approval', done: false },
  ];

  const check = async () => {
    setChecking(true);
    try {
      const me = await api.me();
      setUser(me);
      if (me.status === 'active') toast({ title: "You're verified", body: 'Go online to start receiving jobs.', tone: 'success' });
      else toast({ title: 'Still under review', body: 'We will notify you as soon as you are approved.', tone: 'info' });
    } catch (e) {
      toast({ title: 'Could not check status', body: errorMessage(e), tone: 'danger' });
    } finally {
      setChecking(false);
    }
  };

  return (
    <Screen
      dark
      title="Verification"
      eyebrow="MyCarRepair · Mechanic"
      right={<Button title="Sign out" icon={LogOut} size="sm" kind="onDark" onPress={signOut} />}
      footer={
        <>
          <Button title="Check status" onPress={check} loading={checking} />
          <Button title="Contact admin" icon={Phone} kind="secondary" onPress={() => callPhone(config.supportPhone)} />
        </>
      }>
      <Row gap={Space.sm}>
        <ShieldCheck size={22} color={c.info} />
        <Text variant="label" tone="info">
          {suspended ? 'Account suspended' : 'Verification in progress'}
        </Text>
      </Row>
      <Text variant="title">{suspended ? 'Your account is suspended' : 'Application under review'}</Text>
      <Text tone="textMuted">
        Hi {firstName(user.fullName)}, {suspended ? 'please contact our team to resolve this.' : 'we are verifying your garage details. Approval usually takes less than 24 hours.'}
      </Text>
      <Card style={{ gap: Space.md }}>
        {steps.map((s) => (
          <Row key={s.label} gap={Space.md}>
            {s.done ? <CircleCheck size={22} color={c.success} /> : s.label === 'Admin approval' ? <Clock size={22} color={c.warning} /> : <Circle size={22} color={c.border} />}
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" tone={s.done ? 'text' : 'textMuted'}>
                {s.label}
              </Text>
              {s.phase2 ? <Text variant="caption">Document upload is coming soon — the admin may call you for documents.</Text> : null}
            </View>
          </Row>
        ))}
      </Card>
      <Button title="Upload documents" icon={Upload} kind="outline" disabled />
      {localApi ? (
        <View style={{ gap: Space.sm, marginTop: Space.lg }}>
          <InlineNotice tone="warning">
            Local data mode: there is no admin portal connected, so you can approve this account yourself for testing.
          </InlineNotice>
          <Button
            title="Approve now (local mode)"
            kind="info"
            onPress={async () => {
              try {
                setUser(await localApi!.devApproveSelf());
              } catch (e) {
                toast({ title: 'Could not approve', body: errorMessage(e), tone: 'danger' });
              }
            }}
          />
        </View>
      ) : null}
    </Screen>
  );
}
