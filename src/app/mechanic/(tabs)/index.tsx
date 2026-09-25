import { router } from 'expo-router';
import { Briefcase, CalendarDays, MapPinOff, Siren } from '@/components/icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { api, type MechanicTab } from '@/api';
import { errorMessage } from '@/api/errors';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  haptic,
  InlineNotice,
  JobListItem,
  Row,
  Screen,
  Segmented,
  SkeletonList,
  StatTile,
  StatusPill,
  Text,
} from '@/components';
import { shareLocationOnce, usePresence } from '@/features/mechanic-presence';
import { qk, useMechanicJobs, useMechanicStats } from '@/hooks/queries';
import type { Job } from '@/models';
import { LocationPermissionError, openSettings } from '@/services/location';
import { queryClient } from '@/services/query-client';
import { Keys, kv } from '@/services/storage';
import { useSession, useUser } from '@/store/session';
import { toast } from '@/store/toast';
import { Brand, Font, Space, useColors } from '@/theme';
import { confirm } from '@/utils/confirm';
import { formatDate } from '@/utils/format';
import { formatKm } from '@/utils/geo';
import { vehicleLabel } from '@/utils/jobs';

// Mechanic Jobs tab: the main job board.

/** M1 Job board — duty toggle, stats, SOS/Bookings/Active/History, distance-sorted, inline Accept/Skip. */
export default function JobBoard() {
  const user = useUser();
  const setUser = useSession((s) => s.setUser);
  const coords = usePresence((s) => s.coords);
  const locationError = usePresence((s) => s.locationError);
  const online = !!user?.isOnline;
  const [chosenTab, setTab] = useState<MechanicTab>(online ? 'sos' : 'bookings');
  // Offline mode hides the SOS tab.
  const tab: MechanicTab = !online && chosenTab === 'sos' ? 'bookings' : chosenTab;
  const [toggling, setToggling] = useState(false);
  // ID of the job whose Accept/Decline is in progress.
  const [busy, setBusy] = useState<number | null>(null);
  // SOS jobs this mechanic skipped; hidden only on this device (saved per user).
  const [skipped, setSkipped] = useState<number[]>([]);

  // All four lists load so tab counts stay current; SOS and bookings auto-refresh.
  const stats = useMechanicStats();
  const sos = useMechanicJobs('sos', coords, { live: online });
  const bookings = useMechanicJobs('bookings', coords, { live: true });
  const active = useMechanicJobs('active', coords);
  const history = useMechanicJobs('history', coords);
  const lists = { sos, bookings, active, history };
  const q = lists[tab];

  useEffect(() => {
    if (user) void kv.get<number[]>(Keys.skippedJobs(user.id), []).then(setSkipped);
  }, [user]);

  // Goes online/offline. Going online first sends a fresh GPS position (SOS dispatch needs it) and
  // fails with a Settings shortcut if location is denied.
  const toggleOnline = async (next: boolean) => {
    setToggling(true);
    try {
      if (next) await shareLocationOnce();
      const u = await api.setOnline(next);
      setUser(u);
      haptic('light');
      if (next) setTab('sos');
      void queryClient.invalidateQueries({ queryKey: ['mechanic'] });
    } catch (e) {
      if (e instanceof LocationPermissionError) {
        toast({ title: 'Location needed to go online', body: 'SOS alerts go to the nearest mechanics. Tap to open settings.', tone: 'warning', onPress: openSettings });
      } else {
        toast({ title: next ? 'Could not go online' : 'Could not go offline', body: errorMessage(e), tone: 'danger' });
      }
    } finally {
      setToggling(false);
    }
  };

  // Claims the job and opens it. If another mechanic got there first, says so and refreshes the board.
  const accept = async (job: Job) => {
    setBusy(job.id);
    try {
      const accepted = await api.acceptJob(job.id);
      haptic('success');
      // Seed the job cache so the job screen opens instantly.
      queryClient.setQueryData(qk.job(job.id), accepted);
      void queryClient.invalidateQueries({ queryKey: ['mechanic'] });
      router.push(`/mechanic/job/${job.id}`);
    } catch (e) {
      toast({ title: 'Too late', body: errorMessage(e), tone: 'warning' });
      void queryClient.invalidateQueries({ queryKey: ['mechanic'] });
    } finally {
      setBusy(null);
    }
  };

  // Declining a booking cancels it for the owner (after confirmation). Skipping an SOS just hides it here.
  const skip = async (job: Job) => {
    if (!user) return;
    if (!job.sosActive) {
      if (!(await confirm('Decline booking?', 'Declining cancels this booking for the owner, as on the web.', 'Decline', true))) return;
      setBusy(job.id);
      try {
        await api.declineJob(job.id);
        void queryClient.invalidateQueries({ queryKey: ['mechanic'] });
      } catch (e) {
        toast({ title: 'Could not decline', body: errorMessage(e), tone: 'danger' });
      } finally {
        setBusy(null);
      }
      return;
    }
    const next = [...skipped, job.id].slice(-200);
    setSkipped(next);
    void kv.set(Keys.skippedJobs(user.id), next);
  };

  const refresh = () => {
    void stats.refetch();
    void q.refetch();
  };

  const visible = (q.data ?? []).filter((j) => tab !== 'sos' || !skipped.includes(j.id));
  const counts = {
    sos: online ? (sos.data ?? []).filter((j) => !skipped.includes(j.id)).length : undefined,
    bookings: bookings.data?.length,
    active: active.data?.length,
  };

  return (
    <Screen
      noHeader
      inTabs
      dark
      refreshing={q.isRefetching}
      onRefresh={refresh}
      headerContent={
        <View style={styles.hero}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text variant="label" style={{ color: '#94a3b8' }}>
                Mechanic
              </Text>
              <Text variant="title" style={{ color: '#fff' }} numberOfLines={1}>
                {user?.fullName}
              </Text>
            </View>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: online }}
              accessibilityLabel={online ? 'Online. Tap to go offline' : 'Offline. Tap to go online'}
              onPress={() => !toggling && toggleOnline(!online)}
              style={[styles.toggle, { backgroundColor: online ? 'rgba(22,163,74,0.2)' : 'rgba(255,255,255,0.08)' }]}>
              <View style={[styles.dot, { backgroundColor: online ? '#22c55e' : '#94a3b8' }]} />
              <Text style={{ color: '#fff', fontFamily: Font.bold }}>{online ? 'Online' : 'Offline'}</Text>
              <Switch value={online} onValueChange={toggleOnline} disabled={toggling} trackColor={{ true: Brand.green, false: '#475569' }} thumbColor="#fff" />
            </Pressable>
          </Row>
          <Row gap={Space.sm} style={{ marginTop: Space.md }}>
            <StatTile dark value={String(stats.data?.totalJobs ?? '—')} label="Jobs" />
            <StatTile dark value={String(stats.data?.activeJobs ?? '—')} label="Active" />
            <StatTile dark value={stats.data?.rating ? `${stats.data.rating.toFixed(1)}★` : 'New'} label="Rating" />
          </Row>
          <View style={{ marginTop: Space.md }}>
            <Segmented
              dark
              options={(online ? ['sos', 'bookings', 'active', 'history'] : ['bookings', 'active', 'history']) as MechanicTab[]}
              value={tab}
              onChange={setTab}
              labels={{ sos: 'SOS', bookings: 'Bookings', active: 'Active', history: 'History' }}
              counts={counts}
            />
          </View>
        </View>
      }>
      {!online ? (
        <InlineNotice tone="info" icon={Siren}>
          You are offline. Go online to receive SOS alerts from owners near you.
        </InlineNotice>
      ) : locationError ? (
        <View style={{ gap: Space.sm }}>
          <InlineNotice tone="warning" icon={MapPinOff}>
            {locationError} SOS alerts need your location.
          </InlineNotice>
          <Button title="Open settings" kind="outline" size="md" onPress={openSettings} />
        </View>
      ) : null}

      {q.isLoading ? (
        <SkeletonList />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={tab === 'sos' ? Siren : tab === 'bookings' ? CalendarDays : Briefcase}
          title={
            tab === 'sos' ? 'No SOS nearby right now' : tab === 'bookings' ? 'No open bookings' : tab === 'active' ? 'No active jobs' : 'No completed jobs yet'
          }
          body={tab === 'sos' ? 'Stay online — new emergencies within 10 km pop up instantly.' : undefined}
        />
      ) : tab === 'sos' || tab === 'bookings' ? (
        visible.map((j) => <OpenJobCard key={j.id} job={j} busy={busy === j.id} onAccept={() => accept(j)} onSkip={() => skip(j)} />)
      ) : (
        visible.map((j) => <JobListItem key={j.id} job={j} showMechanic={false} onPress={() => router.push(`/mechanic/job/${j.id}`)} />)
      )}
    </Screen>
  );
}

/** An open SOS or booking with its distance, owner, car and date, and Accept / Skip (or Decline) buttons. */
function OpenJobCard({ job, onAccept, onSkip, busy }: { job: Job; onAccept: () => void; onSkip: () => void; busy: boolean }) {
  const c = useColors();
  // Only the details area opens the job; the action buttons sit outside it (no button inside a button).
  return (
    <Card style={{ gap: Space.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${job.serviceType}, ${formatKm(job.distanceKm)}. Open details`}
        onPress={() => router.push(`/mechanic/job/${job.id}`)}
        style={({ pressed }) => ({ gap: Space.sm, opacity: pressed ? 0.8 : 1 })}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={Space.sm} style={{ flex: 1 }}>
            {job.sosActive ? <Siren size={18} color={c.danger} /> : <CalendarDays size={18} color={c.info} />}
            <Text variant="heading" numberOfLines={1} style={{ flexShrink: 1 }}>
              {job.serviceType}
            </Text>
          </Row>
          {job.distanceKm != null ? (
            <Text variant="bodyStrong">{formatKm(job.distanceKm)}</Text>
          ) : job.sosActive ? (
            <StatusPill label="SOS" tone="danger" />
          ) : null}
        </Row>
        <Text tone="textMuted">
          {job.owner?.fullName ?? 'Owner'} · {job.vehicle ? `${vehicleLabel(job.vehicle)} ${job.vehicle.year}` : 'Vehicle'}
        </Text>
        {job.scheduledDate ? (
          <Text variant="caption">
            For {formatDate(job.scheduledDate, { weekday: 'short', day: 'numeric', month: 'short' })}
            {job.notes ? ` · “${job.notes}”` : ''}
          </Text>
        ) : null}
      </Pressable>
      <Row gap={Space.sm} style={{ marginTop: Space.xs }}>
        <Button title={job.sosActive ? 'Skip' : 'Decline'} kind="secondary" size="md" style={{ flex: 1 }} onPress={onSkip} disabled={busy} />
        <Button title="Accept" kind={job.sosActive ? 'danger' : 'primary'} size="md" style={{ flex: 1 }} onPress={onAccept} loading={busy} />
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: Space.lg, paddingBottom: Space.lg, paddingTop: Space.sm },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingLeft: Space.md, paddingRight: 4, borderRadius: 999, minHeight: 48 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
