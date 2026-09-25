import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheck, FileText, Lock, MapPinned, Navigation, Phone, Plus, Share2, Star } from '@/components/icons';
import { useState } from 'react';
import { View } from 'react-native';

import { api } from '@/api';
import { errorMessage } from '@/api/errors';
import {
  Button,
  Card,
  ChecklistRow,
  Divider,
  ErrorState,
  FinishLock,
  haptic,
  InlineNotice,
  MapCard,
  ProgressBar,
  QuoteCard,
  Row,
  Screen,
  Section,
  SkeletonList,
  Text,
  type MapPoint,
} from '@/components';
import { usePresence } from '@/features/mechanic-presence';
import { useJob } from '@/hooks/queries';
import type { ChecklistItem, Job } from '@/models';
import { callPhone, openNavigation } from '@/services/location';
import { PermissionDeniedError, pickPhotos } from '@/services/media';
import { queryClient } from '@/services/query-client';
import { openReceipt, shareReceipt } from '@/services/receipt';
import { toast } from '@/store/toast';
import { Space, useColors } from '@/theme';
import { confirm } from '@/utils/confirm';
import { formatDate, formatUGX } from '@/utils/format';
import { distanceKm, etaMinutes, formatKm } from '@/utils/geo';
import { canFinish, computeTotals, parseFeedback, progress, statusLabel, vehicleLabel } from '@/utils/jobs';

// Mechanic's screen for one job. Shows a different view for each stage of the job.

/**
 * M3 En route (accepted) → M4 Digital job card (fixing) → completion summary. An open job that hasn't
 * been accepted yet shows its details with an Accept button.
 */
export default function MechanicJob() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const q = useJob(id, { live: true });
  const job = q.data;
  if (!job) {
    return (
      <Screen back title="Job">
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <SkeletonList count={4} />}
      </Screen>
    );
  }
  if (job.status === 'accepted') return <EnRoute job={job} refetch={() => q.refetch()} />;
  if (job.status === 'pending') return <OpenJob job={job} />;
  if (job.status === 'completed' || job.status === 'cancelled') return <Summary job={job} />;
  return <JobCard job={job} refreshing={q.isRefetching} refetch={() => q.refetch()} />;
}

/** Refreshes the job and the mechanic's lists; if an updated `job` is given, shows it immediately. */
function invalidate(id: number, job?: Job) {
  if (job) queryClient.setQueryData(['job', id], job);
  void queryClient.invalidateQueries({ queryKey: ['job', id] });
  void queryClient.invalidateQueries({ queryKey: ['mechanic'] });
}

/** Not yet accepted: job details and an Accept button. Contact details stay hidden until accepted. */
function OpenJob({ job }: { job: Job }) {
  const [busy, setBusy] = useState(false);
  const accept = async () => {
    setBusy(true);
    try {
      const accepted = await api.acceptJob(job.id);
      haptic('success');
      invalidate(job.id, accepted);
    } catch (e) {
      toast({ title: 'Too late', body: errorMessage(e), tone: 'warning' });
      invalidate(job.id);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen back title={job.serviceType} eyebrow={`Job #${job.id} · ${job.sosActive ? 'SOS' : 'Booking'}`} footer={<Button title="Accept job" onPress={accept} loading={busy} kind={job.sosActive ? 'danger' : 'primary'} />}>
      <Card style={{ gap: Space.sm }}>
        <Text variant="heading">{job.owner?.fullName}</Text>
        <Text tone="textMuted">{job.vehicle ? `${vehicleLabel(job.vehicle)} ${job.vehicle.year} · ${job.vehicle.plateNumber}` : ''}</Text>
        {job.vehicle?.tyreSize ? <Text variant="caption">Tyre {job.vehicle.tyreSize} · {job.vehicle.fuelType} · {job.vehicle.transmission}</Text> : null}
        {job.distanceKm != null ? <Text variant="bodyStrong">{formatKm(job.distanceKm)} away</Text> : null}
        {job.scheduledDate ? <Text>For {formatDate(job.scheduledDate, { weekday: 'long', day: 'numeric', month: 'long' })}</Text> : null}
        {job.notes ? <Text tone="textMuted">“{job.notes}”</Text> : null}
      </Card>
      <Text variant="caption">Phone number and exact location are shared once you accept.</Text>
    </Screen>
  );
}

/** M3 En route — navigate and share live location with the owner. */
function EnRoute({ job, refetch }: { job: Job; refetch: () => void }) {
  const c = useColors();
  const coords = usePresence((s) => s.coords);
  const [busy, setBusy] = useState(false);
  const o = job.owner;
  // Where the car is (the owner's position), the distance from the mechanic, and the map pins.
  const dest = o?.locationLat != null && o.locationLng != null ? { lat: o.locationLat, lng: o.locationLng } : null;
  const km = dest && coords ? distanceKm(coords.lat, coords.lng, dest.lat, dest.lng) : null;
  const points = [
    dest ? ({ ...dest, label: o?.fullName ?? 'Owner', kind: 'owner' } as MapPoint) : null,
    coords ? ({ ...coords, label: 'You', kind: 'me' } as MapPoint) : null,
  ].filter(Boolean) as MapPoint[];

  // Marks arrival; the job moves to "fixing" and this screen switches to the job card.
  const arrived = async () => {
    setBusy(true);
    try {
      const updated = await api.markArrived(job.id);
      haptic('success');
      invalidate(job.id, updated);
      refetch();
    } catch (e) {
      toast({ title: 'Could not update', body: errorMessage(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title={job.sosActive ? 'En route' : job.serviceType} eyebrow={`Job #${job.id} · ${statusLabel(job.status)}`} footer={<Button title="I have reached the car" icon={MapPinned} onPress={arrived} loading={busy} haptic />}>
      {points.length ? <MapCard points={points} height={260} /> : null}
      {km != null ? (
        <Card tone="dark">
          <Row style={{ justifyContent: 'space-between' }}>
            <View>
              <Text variant="label" style={{ color: '#94a3b8' }}>
                Distance
              </Text>
              <Text variant="title" style={{ color: '#fff' }}>
                {formatKm(km)}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text variant="label" style={{ color: '#94a3b8' }}>
                ETA
              </Text>
              <Text variant="title" style={{ color: c.primary }}>
                {etaMinutes(km)} min
              </Text>
            </View>
          </Row>
        </Card>
      ) : null}
      <Card style={{ gap: 4 }}>
        <Text variant="heading">{o?.fullName}</Text>
        <Text tone="textMuted">
          {job.serviceType} · {job.vehicle ? `${vehicleLabel(job.vehicle)} · ${job.vehicle.plateNumber}` : ''}
        </Text>
        {job.vehicle?.tyreSize ? <Text variant="caption">Tyre {job.vehicle.tyreSize}</Text> : null}
        {job.scheduledDate ? <Text variant="caption">Booked for {formatDate(job.scheduledDate, { weekday: 'short', day: 'numeric', month: 'short' })}</Text> : null}
        {job.notes ? <Text variant="caption">“{job.notes}”</Text> : null}
      </Card>
      <Row gap={Space.sm}>
        <Button title="Call" icon={Phone} kind="secondary" size="md" style={{ flex: 1 }} onPress={() => callPhone(o?.phone)} disabled={!o?.phone} />
        <Button title="Maps" icon={Navigation} kind="info" size="md" style={{ flex: 1 }} onPress={() => dest && openNavigation(dest.lat, dest.lng)} disabled={!dest} />
      </Row>
      <InlineNotice tone="info">
        Sharing your location with {o?.fullName?.split(' ')[0] ?? 'the owner'} every 15 s while MyCarRepair is open. Keep the app open on the way.
      </InlineNotice>
    </Screen>
  );
}

/** M4 Digital job card — tap tasks, photo proof, lock rules, quotes. */
function JobCard({ job, refreshing, refetch }: { job: Job; refreshing: boolean; refetch: () => void }) {
  const c = useColors();
  // ID of the task being saved, so its row is disabled meanwhile.
  const [busyTask, setBusyTask] = useState<number | null>(null);
  const [finishing, setFinishing] = useState(false);
  const pr = progress(job.checklist);
  // Whether "Finish job" is allowed, and what's still blocking it.
  const lock = canFinish(job);
  const totals = job.totals ?? computeTotals(job.quotes);

  // Ticks or unticks a task.
  const toggle = async (t: ChecklistItem) => {
    setBusyTask(t.id);
    try {
      await api.updateTask(t.id, { isCompleted: !t.isCompleted });
      haptic('light');
      invalidate(job.id);
    } catch (e) {
      toast({ title: 'Could not update task', body: errorMessage(e), tone: 'danger' });
    } finally {
      setBusyTask(null);
    }
  };

  // Takes a photo as proof for a task, and marks the task done with it.
  const photo = async (t: ChecklistItem) => {
    try {
      const [p] = await pickPhotos('camera', 1);
      if (!p) return;
      setBusyTask(t.id);
      await api.updateTask(t.id, { isCompleted: true, photo: p });
      haptic('success');
      invalidate(job.id);
    } catch (e) {
      toast({ title: e instanceof PermissionDeniedError ? 'Camera permission needed' : 'Could not save photo', body: errorMessage(e), tone: 'danger' });
    } finally {
      setBusyTask(null);
    }
  };

  // Completes the job after confirming the total; the owner then gets the receipt.
  const finish = async () => {
    if (!lock.ok) return;
    if (!(await confirm('Finish job?', `Total ${formatUGX(totals.total)} will be billed and the receipt sent to the owner.`, 'Finish job'))) return;
    setFinishing(true);
    try {
      const done = await api.completeJob(job.id);
      haptic('success');
      invalidate(job.id, done);
      toast({ title: 'Job complete', body: `Receipt sent · ${formatUGX(totals.total)}`, tone: 'success' });
    } catch (e) {
      toast({ title: 'Cannot finish yet', body: errorMessage(e), tone: 'warning' });
    } finally {
      setFinishing(false);
    }
  };

  return (
    <Screen
      back
      title="Digital Job Card"
      eyebrow={`Job #${job.id} · ${job.vehicle ? vehicleLabel(job.vehicle) : ''}`}
      refreshing={refreshing}
      onRefresh={refetch}
      footer={
        <>
          <FinishLock openTasks={lock.openTasks} openQuotes={lock.openQuotes} />
          <Button title="Finish job" icon={lock.ok ? CircleCheck : Lock} kind={lock.ok ? 'success' : 'secondary'} onPress={finish} disabled={!lock.ok} loading={finishing} />
        </>
      }>
      <Card style={{ gap: Space.sm }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="heading">{job.serviceType}</Text>
          <Text variant="bodyStrong">
            {pr.done} / {pr.total}
          </Text>
        </Row>
        <ProgressBar pct={pr.pct} color={c.success} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="caption">
            {job.owner?.fullName} · {job.vehicle?.plateNumber}
          </Text>
          {job.owner?.phone ? (
            <Button title="Call" icon={Phone} size="sm" kind="ghost" onPress={() => callPhone(job.owner?.phone)} />
          ) : null}
        </Row>
      </Card>

      <Section title="Checklist" style={{ marginTop: Space.sm }}>
        <Card style={{ paddingVertical: Space.xs }}>
          {(job.checklist ?? []).map((t) => (
            <ChecklistRow key={t.id} item={t} onToggle={() => toggle(t)} onPhoto={() => photo(t)} disabled={busyTask === t.id} />
          ))}
        </Card>
        <Text variant="caption">Tap a task to tick it. Use the camera for photo proof.</Text>
      </Section>

      <Section title="Parts">
        {(job.quotes ?? []).map((qt) => (
          <QuoteCard key={qt.id} quote={qt} />
        ))}
        <Button title="Quote part" icon={Plus} kind="outline" onPress={() => router.push(`/mechanic/job/${job.id}/quote`)} />
      </Section>

      <Card style={{ gap: Space.sm }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text tone="textMuted">Service fee</Text>
          <Text>{formatUGX(totals.serviceFee)}</Text>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text tone="textMuted">Approved parts</Text>
          <Text>{formatUGX(totals.approvedParts)}</Text>
        </Row>
        <Divider />
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="bodyStrong">Total</Text>
          <Text variant="heading">{formatUGX(totals.total)}</Text>
        </Row>
      </Card>
    </Screen>
  );
}

/** Finished job: total, receipt PDF, the owner's review and the parts. Cancelled jobs just say so. */
function Summary({ job }: { job: Job }) {
  const c = useColors();
  const [busy, setBusy] = useState<'open' | 'share' | null>(null);
  const review = job.review ? parseFeedback(job.review.feedback) : null;
  // Opens or shares the PDF receipt.
  const pdf = async (kind: 'open' | 'share') => {
    setBusy(kind);
    try {
      if (kind === 'open') await openReceipt(job.id);
      else await shareReceipt(job.id);
    } catch (e) {
      toast({ title: 'Receipt unavailable', body: errorMessage(e), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };
  if (job.status === 'cancelled') {
    return (
      <Screen back title={job.serviceType} eyebrow={`Job #${job.id}`}>
        <InlineNotice tone="warning">This job was cancelled.</InlineNotice>
      </Screen>
    );
  }
  return (
    <Screen back title={job.serviceType} eyebrow={`Job #${job.id} · Done`}>
      <Card tone="dark" style={{ alignItems: 'center', gap: 4 }}>
        <CircleCheck size={32} color={c.success} />
        <Text variant="label" style={{ color: '#cbd5e1' }}>
          Job total
        </Text>
        <Text variant="display" style={{ color: '#fff' }}>
          {formatUGX(job.totalPrice)}
        </Text>
        <Text style={{ color: '#cbd5e1' }}>
          {job.owner?.fullName} · {job.vehicle ? vehicleLabel(job.vehicle) : ''} · {formatDate(job.updatedAt)}
        </Text>
      </Card>
      <Row gap={Space.sm}>
        <Button title="Receipt PDF" icon={FileText} kind="secondary" size="md" style={{ flex: 1 }} onPress={() => pdf('open')} loading={busy === 'open'} />
        <Button title="Share" icon={Share2} kind="secondary" size="md" style={{ flex: 1 }} onPress={() => pdf('share')} loading={busy === 'share'} />
      </Row>
      {job.review && review ? (
        <Section title="Owner review">
          <Card style={{ gap: Space.sm }}>
            <Row gap={4}>
              {Array.from({ length: job.review.rating }, (_, i) => (
                <Star key={i} size={18} color="#f59e0b" fill="#f59e0b" />
              ))}
            </Row>
            {review.tags.length ? <Text variant="bodyStrong">{review.tags.join(' · ')}</Text> : null}
            {review.comment ? <Text>{review.comment}</Text> : null}
          </Card>
        </Section>
      ) : (
        <Text variant="caption" center>
          The owner has not rated this job yet.
        </Text>
      )}
      {(job.quotes ?? []).length ? (
        <Section title="Parts">
          {job.quotes!.map((qt) => (
            <QuoteCard key={qt.id} quote={qt} />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}
