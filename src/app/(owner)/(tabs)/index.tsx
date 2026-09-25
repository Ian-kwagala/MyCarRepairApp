import * as Location from 'expo-location';
import { router } from 'expo-router';
import { Bell, CalendarDays, ChevronRight, MapPin, Plus, Siren, Stethoscope } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  InlineNotice,
  ProgressBar,
  Row,
  Screen,
  Section,
  SkeletonList,
  StatusPill,
  Text,
  VehicleCard,
} from '@/components';
import { useJobs, useVehicles } from '@/hooks/queries';
import { useNotifications } from '@/hooks/use-notifications';
import { useOnline } from '@/hooks/use-online';
import type { Job } from '@/models';
import { reverseGeocode } from '@/services/location';
import { useUser } from '@/store/session';
import { Brand, Radius, Space, useColors } from '@/theme';
import { greeting } from '@/utils/format';
import { pendingQuotes, progress, statusLabel, statusTone } from '@/utils/jobs';

// Owner Home tab.

/** O1 Owner home — fastest path to SOS (1 tap), services, active repair, garage. */
export default function OwnerHome() {
  const c = useColors();
  const user = useUser();
  const online = useOnline();
  const vehicles = useVehicles();
  const active = useJobs('active', { live: true });
  const { unread } = useNotifications();
  const [place, setPlace] = useState<string | null>(null);
  const [locGranted, setLocGranted] = useState<boolean | null>(null);

  // Show the owner's area in the header. Only checks permission here (never prompts); the prompt waits
  // until they send an SOS.
  useEffect(() => {
    void (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        setLocGranted(perm.granted);
        if (perm.granted) {
          const pos = await Location.getLastKnownPositionAsync();
          if (pos) setPlace(await reverseGeocode(pos.coords.latitude, pos.coords.longitude));
        }
      } catch {
        setLocGranted(null);
      }
    })();
  }, []);

  const hasCar = (vehicles.data?.length ?? 0) > 0;
  // Every service needs a car: without one, send the owner to add a car first, then on to `target`.
  const needCar =(target: '/sos' | '/book' | '/diagnostics') => () => {
    if (!vehicles.isLoading && !hasCar) router.push({ pathname: '/vehicle/add', params: { then: target } });
    else router.push(target);
  };

  const refresh = () => {
    void vehicles.refetch();
    void active.refetch();
  };

  return (
    <Screen
      noHeader
      inTabs
      dark
      refreshing={vehicles.isRefetching || active.isRefetching}
      onRefresh={refresh}
      contentStyle={{ paddingTop: 0 }}
      headerContent={
        <View style={styles.hero}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#cbd5e1' }}>{greeting()}</Text>
              <Text variant="title" style={{ color: '#fff' }} numberOfLines={1}>
                {user?.fullName}
              </Text>
              <Row gap={6} style={{ marginTop: 4 }}>
                <MapPin size={14} color={Brand.orange} />
                <Text variant="caption" style={{ color: '#cbd5e1' }}>
                  {place ?? 'Kampala'}
                </Text>
                <View style={[styles.dot, { backgroundColor: online ? c.success : c.warning }]} />
                <Text variant="caption" style={{ color: '#cbd5e1' }}>
                  {online ? 'Online' : 'Offline'}
                </Text>
              </Row>
            </View>
            <IconButton icon={Bell} label="Notifications" color="#fff" badge={unread} onPress={() => router.push('/notifications')} background="rgba(255,255,255,0.08)" />
          </Row>
        </View>
      }>
      <Text variant="label" style={{ marginTop: Space.lg }}>
        What do you need today?
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Emergency SOS. Towing, flat tyre, battery jump"
        onPress={needCar('/sos')}
        style={({ pressed }) => [styles.sos, { opacity: pressed ? 0.9 : 1 }]}>
        <View style={styles.sosIcon}>
          <Siren size={30} color={Brand.red} strokeWidth={2.5} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="heading" style={{ color: '#fff', fontSize: 22 }}>
            Emergency SOS
          </Text>
          <Text style={{ color: '#fee2e2' }}>Towing, flat tyre, battery jump</Text>
        </View>
        <ChevronRight size={24} color="#fff" />
      </Pressable>

      <Row gap={Space.md}>
        <ServiceCard icon={CalendarDays} title="Book Service" sub="Oil, brakes" onPress={needCar('/book')} />
        <ServiceCard icon={Stethoscope} title="Diagnostics" sub="Symptoms" onPress={needCar('/diagnostics')} />
      </Row>

      {locGranted === false ? (
        <InlineNotice tone="info" icon={MapPin}>
          Allow location so SOS can send help to exactly where you are. You will be asked when you send an SOS.
        </InlineNotice>
      ) : null}

      {active.error ? <ErrorState error={active.error} onRetry={() => active.refetch()} /> : null}
      {(active.data ?? []).map((job) => (
        <ActiveRepairCard key={job.id} job={job} />
      ))}

      <Section
        title="My garage"
        action={
          hasCar ? (
            <Pressable accessibilityRole="button" onPress={() => router.push('/garage')} hitSlop={8}>
              <Text tone="primary" variant="bodyStrong">
                See all
              </Text>
            </Pressable>
          ) : null
        }>
        {vehicles.isLoading ? (
          <SkeletonList count={1} />
        ) : vehicles.error ? (
          <ErrorState error={vehicles.error} onRetry={() => vehicles.refetch()} />
        ) : hasCar ? (
          vehicles.data!.slice(0, 2).map((v) => <VehicleCard key={v.id} vehicle={v} compact onPress={() => router.push(`/vehicle/${v.id}`)} />)
        ) : (
          <Card>
            <EmptyState
              icon={Plus}
              title="Add your first car"
              body="Save your car once and request help in seconds."
              action={<Button title="Add a car" icon={Plus} onPress={() => router.push('/vehicle/add')} />}
            />
          </Card>
        )}
      </Section>
    </Screen>
  );
}

/** Square shortcut tile for a service (Book Service, Diagnostics). */
function ServiceCard({ icon: Icon, title, sub, onPress }: { icon: typeof Siren; title: string; sub: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}`}
      onPress={onPress}
      style={({ pressed }) => [styles.service, { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}>
      <View style={[styles.serviceIcon, { backgroundColor: c.primarySoft }]}>
        <Icon size={24} color={Brand.orange} />
      </View>
      <Text variant="bodyStrong">{title}</Text>
      <Text variant="caption">{sub}</Text>
    </Pressable>
  );
}

/**
 * Summary card for a job in progress. Opens the live SOS screen while an SOS is searching or the
 * mechanic is on the way, otherwise the job details. An orange edge flags quotes awaiting approval.
 */
function ActiveRepairCard({ job }: { job: Job }) {
  const c = useColors();
  const pr = progress(job.checklist);
  const quotes = pendingQuotes(job).length;
  const isSosSearch = job.sosActive && (job.status === 'pending' || job.status === 'accepted');
  // Status line built from whichever parts apply, joined with " · ".
  const detail = [
    job.status === 'pending' ? (job.sosActive ? 'Finding a mechanic…' : 'Waiting for a mechanic to accept') : null,
    job.status === 'accepted' ? `${job.mechanic?.fullName ?? 'Mechanic'} ${job.sosActive ? 'is on the way' : 'accepted'}` : null,
    job.status === 'fixing' && pr.total ? `${pr.done} of ${pr.total} tasks` : null,
    quotes ? `${quotes} quote${quotes > 1 ? 's' : ''} waiting` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Card
      tone="dark"
      onPress={() => router.push(isSosSearch ? `/sos/${job.id}` : `/job/${job.id}`)}
      accessibilityLabel={`Active repair: ${job.serviceType}, ${statusLabel(job.status)}`}
      style={{ gap: Space.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="label" style={{ color: '#cbd5e1' }}>
          Active {job.sosActive ? 'SOS' : 'repair'} · {statusLabel(job.status)}
        </Text>
        {quotes ? <StatusPill label="Action needed" tone="warning" /> : <StatusPill label={statusLabel(job.status)} tone={statusTone(job.status)} />}
      </Row>
      <Text variant="heading" style={{ color: '#fff' }}>
        {job.serviceType}
        {job.vehicle ? ` · ${job.vehicle.plateNumber}` : ''}
      </Text>
      {job.status === 'fixing' && pr.total ? <ProgressBar pct={pr.pct} /> : null}
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={{ color: '#cbd5e1', flex: 1 }}>{detail}</Text>
        <ChevronRight size={20} color="#fff" />
      </Row>
      {quotes ? <View style={[styles.quoteBar, { backgroundColor: c.primary }]} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: Space.lg, paddingBottom: Space.xl, paddingTop: Space.sm },
  dot: { width: 8, height: 8, borderRadius: 4, marginLeft: Space.sm },
  sos: {
    backgroundColor: Brand.red,
    borderRadius: Radius.card,
    padding: Space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: 96,
  },
  sosIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  service: { flex: 1, borderRadius: Radius.card, borderWidth: StyleSheet.hairlineWidth, padding: Space.lg, gap: 4, minHeight: 120 },
  serviceIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: Space.sm },
  quoteBar: { position: 'absolute', left: 0, top: 16, bottom: 16, width: 4, borderRadius: 2 },
});

