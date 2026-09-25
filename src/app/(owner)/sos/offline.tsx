import { router } from 'expo-router';
import { MessageSquare, Phone, WifiOff } from '@/components/icons';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';

import { Button, Card, InlineNotice, Screen, Text } from '@/components';
import { useConfig } from '@/hooks/queries';
import { callPhone } from '@/services/location';
import { sosQueue, type QueuedSos } from '@/services/sos-queue';
import { Space, useColors } from '@/theme';
import { formatTime } from '@/utils/format';

// Shown when an SOS couldn't be sent because the phone is offline.

/**
 * X1 Offline SOS — never lose an emergency request. Auto-sends when signal returns. Also offers to send
 * it by SMS or call the support line right away.
 */
export default function OfflineSos() {
  const c = useColors();
  const config = useConfig();
  const [q, setQ] = useState<QueuedSos | null>(null);

  // Re-check the queue every 3 s so the screen updates once the SOS has been sent in the background.
  useEffect(() => {
    void sosQueue.get().then(setQ);
    const t = setInterval(() => void sosQueue.get().then(setQ), 3000);
    return () => clearInterval(t);
  }, []);

  // Short text with the issue, plate and GPS position, so SMS works with no data connection.
  const smsBody = q ? `SOS ${q.issue} ${q.plate} GPS ${q.lat.toFixed(5)},${q.lng.toFixed(5)}` : '';

  return (
    <Screen
      back={() => router.replace('/')}
      title="Emergency SOS"
      footer={
        <>
          <Button title="Send by SMS now" icon={MessageSquare} kind="danger" onPress={() => Linking.openURL(`sms:${config.supportPhone}?body=${encodeURIComponent(smsBody)}`)} disabled={!q} />
          <Button title="Call emergency line" icon={Phone} kind="secondary" onPress={() => callPhone(config.supportPhone)} />
        </>
      }>
      <View style={{ alignItems: 'center', gap: Space.sm, paddingVertical: Space.lg }}>
        <WifiOff size={48} color={c.warning} />
        <Text variant="title" center>
          You are offline
        </Text>
        <Text center tone="textMuted">
          Your SOS is saved and will send automatically when signal returns.
        </Text>
      </View>
      {q ? (
        <Card style={{ gap: 4 }}>
          <Text variant="label">Queued request</Text>
          <Text variant="heading">
            {q.issue} · {q.plate}
          </Text>
          <Text variant="caption">
            GPS {q.lat.toFixed(4)}, {q.lng.toFixed(4)} · {formatTime(q.queuedAt)}
          </Text>
        </Card>
      ) : (
        <InlineNotice tone="success">No queued request — it may already have been sent.</InlineNotice>
      )}
      <Text variant="caption" center>
        SMS goes to the MyCarRepair line and is relayed to nearby mechanics.
      </Text>
      {q ? <Button title="Discard queued SOS" kind="ghost" onPress={async () => { await sosQueue.clear(); router.replace('/'); }} /> : null}
    </Screen>
  );
}
