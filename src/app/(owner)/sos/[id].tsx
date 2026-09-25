import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheck, Phone, Star } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api';
import { errorMessage } from '@/api/errors';
import { Avatar, Button, Card, ErrorState, MapCard, Radar, Row, StatTile, Text, type MapPoint } from '@/components';
import { OfflineBanner } from '@/components/feedback';
import { SOS_TIMEOUT_MS } from '@/constants/config';
import { useConfig, useJob } from '@/hooks/queries';
import { useKeepScreenOn } from '@/hooks/use-keep-awake';
import { useStatusBar } from '@/hooks/use-status-bar';
import { callPhone } from '@/services/location';
import { queryClient } from '@/services/query-client';
import { toast } from '@/store/toast';
import { Brand, Space, useColors } from '@/theme';
import { confirm } from '@/utils/confirm';
import { distanceKm, etaMinutes, formatKm } from '@/utils/geo';

// Owner's live SOS screen, shown right after sending an SOS.

/**
 * O3 SOS broadcasting → O4 mechanic found (live location, ETA, call). Shows the searching radar until a
 * mechanic accepts, then their position and ETA; once they arrive, switches to the repair tracker.
 * Keeps the screen awake throughout.
 */
export default function SosStatus() {
  useKeepScreenOn('sos');
  const c = useColors();
  const insets = useSafeAreaInsets();
  const config = useConfig();
  const params = useLocalSearchParams<{ id: string; nearby?: string; eta?: string }>();
  const id = Number(params.id);
  const job = useJob(id, { live: true });
  const [cancelling, setCancelling] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  const status = job.data?.status;
  const broadcasting = status === 'pending';
  // Navy radar screen while searching; canvas once a mechanic is found.
  useStatusBar(!job.data || broadcasting ? 'light' : 'auto');

  // After SOS_TIMEOUT_MS with no taker (counted from when the SOS was created, so it survives reopening
  // the screen), switch to the "still searching" message and offer the support line.
  useEffect(() => {
    if (!job.data || !broadcasting) return;
    const left =SOS_TIMEOUT_MS - (Date.now() - new Date(job.data.createdAt).getTime());
    const t = setTimeout(() => setTimedOut(true), Math.max(0, left));
    return () => clearTimeout(t);
  }, [job.data, broadcasting]);

  // Mechanic arrived → hand over to the live tracker.
  useEffect(() => {
    if (status && ['diagnosing', 'fixing', 'ready', 'completed'].includes(status)) {
      router.replace(`/job/${id}`);
    }
  }, [status, id]);

  // Cancels the SOS after confirmation (only possible before a mechanic accepts).
  const cancel = async () => {
    if (!(await confirm('Cancel SOS?', 'Nearby mechanics will stop seeing your request.', 'Cancel request', true))) return;
    setCancelling(true);
    try {
      await api.cancelSos(id);
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast({ title: 'SOS cancelled', tone: 'info' });
      router.replace('/');
    } catch (e) {
      toast({ title: 'Could not cancel', body: errorMessage(e), tone: 'danger' });
      void job.refetch();
    } finally {
      setCancelling(false);
    }
  };

  // Goes home; while still searching, first confirms that the SOS stays active.
  const leave = async () => {
    if (broadcasting && !(await confirm('Leave this screen?', 'Your SOS stays active. You can come back from Home.', 'Leave'))) return;
    router.replace('/');
  };

  // Android hardware back asks for confirmation while broadcasting (§9).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      void leave();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcasting]);

  if (job.error && !job.data) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, padding: Space.lg, paddingTop: insets.top + Space.lg }}>
        <ErrorState error={job.error} onRetry={() => job.refetch()} />
        <Button title="Back to home" kind="ghost" onPress={() => router.replace('/')} />
      </View>
    );
  }

  const j = job.data;
  const mech = j?.mechanic;
  // Map pins for the owner and mechanic (only when their positions are known), and the distance between.
  const me: MapPoint | null = j?.owner?.locationLat != null && j.owner.locationLng != null ? { lat: j.owner.locationLat, lng: j.owner.locationLng, label: 'You', kind: 'me' } : null;
  const mechPoint: MapPoint | null = mech?.locationLat != null && mech.locationLng != null ? { lat: mech.locationLat, lng: mech.locationLng, label: mech.fullName, kind: 'mechanic' } : null;
  const km = me && mechPoint ? distanceKm(me.lat, me.lng, mechPoint.lat, mechPoint.lng) : null;

  if (status === 'cancelled') {
    return (
      <View style={[styles.fill, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <View style={styles.center}>
          <Text variant="title">Request cancelled</Text>
          <Text tone="textMuted" center>
            This SOS is no longer active.
          </Text>
        </View>
        <View style={{ padding: Space.lg, paddingBottom: insets.bottom + Space.lg }}>
          <Button title="Back to home" onPress={() => router.replace('/')} />
        </View>
      </View>
    );
  }

  // O3 — still searching (also shown while the job first loads).
  if (!j || broadcasting) {
    // Mechanic count passed from the SOS screen; unknown if the screen was reopened later.
    const nearby =params.nearby != null ? Number(params.nearby) : null;
    return (
      <View style={[styles.fill, { backgroundColor: Brand.navy, paddingTop: insets.top }]}>
        <OfflineBanner />
        <View style={styles.center}>
          <Radar color={Brand.red} size={220} />
          <Text variant="title" style={{ color: '#fff' }}>
            {timedOut ? 'Still searching…' : 'Finding a mechanic…'}
          </Text>
          <Text center style={{ color: '#cbd5e1', maxWidth: 300 }}>
            {timedOut
              ? 'No one has accepted yet. We have widened the search to 20 km. You can also call our support line.'
              : nearby === 0
                ? 'No mechanic is online within 10 km right now. Your request stays open and reaches mechanics as they come online.'
                : nearby != null
                  ? `Alert sent to ${nearby} online mechanic${nearby === 1 ? '' : 's'} within 10 km`
                  : 'Alerting online mechanics near you'}
          </Text>
          <Row gap={Space.md} style={{ alignSelf: 'stretch', marginTop: Space.lg }}>
            <StatTile dark value={nearby != null ? String(nearby) : '—'} label="Nearby" />
            <StatTile dark value={(params.eta ?? '8 – 12 minutes').replace(' minutes', ' min')} label="Est. arrival" />
          </Row>
          {j ? (
            <Text variant="caption" style={{ color: '#94a3b8' }}>
              {j.serviceType} · {j.vehicle?.plateNumber}
            </Text>
          ) : null}
        </View>
        <View style={{ padding: Space.lg, gap: Space.sm, paddingBottom: insets.bottom + Space.lg }}>
          {timedOut ? <Button title="Call support" icon={Phone} kind="secondary" onPress={() => callPhone(config.supportPhone)} /> : null}
          <Button title="Cancel request" kind="onDark" onPress={cancel} loading={cancelling} />
          <Button title="Back to home" kind="onDark" size="md" onPress={leave} />
        </View>
      </View>
    );
  }

  // O4 — mechanic found
  return (
    <View style={[styles.fill, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <OfflineBanner />
      <View style={{ flex: 1, padding: Space.lg, gap: Space.md }}>
        <Row gap={Space.sm}>
          <CircleCheck size={20} color={c.success} />
          <Text variant="label" tone="success">
            Mechanic on the way
          </Text>
        </Row>
        {me || mechPoint ? <MapCard points={[me, mechPoint].filter(Boolean) as MapPoint[]} height={240} /> : null}
        <Card>
          <Row gap={Space.md}>
            <Avatar name={mech?.fullName} size={56} />
            <View style={{ flex: 1 }}>
              <Text variant="heading">{mech?.fullName}</Text>
              <Row gap={4}>
                <Star size={14} color="#f59e0b" fill="#f59e0b" />
                <Text variant="caption">
                  {mech?.rating ? mech.rating.toFixed(1) : 'New'}
                  {mech?.garageName ? ` · ${mech.garageName}` : ''}
                </Text>
              </Row>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text variant="title" tone="primary">
                {km != null ? `${etaMinutes(km)} min` : '—'}
              </Text>
              <Text variant="caption">ETA</Text>
            </View>
          </Row>
        </Card>
        <Row gap={Space.md}>
          <StatTile value={formatKm(km)} label="Distance" />
          <StatTile value={j.vehicle?.plateNumber ?? '—'} label="Your car" />
        </Row>
        <Text variant="caption" center>
          {j.serviceType} · live location updates every 15 s
        </Text>
      </View>
      <View style={{ padding: Space.lg, gap: Space.sm, paddingBottom: insets.bottom + Space.lg }}>
        <Button title="Call mechanic" icon={Phone} onPress={() => callPhone(mech?.phone)} disabled={!mech?.phone} haptic />
        <Button title="Open repair tracker" kind="secondary" onPress={() => router.replace(`/job/${id}`)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.md, padding: Space.xl },
});
