// Mechanic's screen for one job. Shows a different view for each stage of the job.
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarClock, CircleCheck, Clock, FileText, House, ListPlus, Lock, MapPinned, Navigation, Phone, Plus, Share2, Star, Truck } from '@/components/icons';
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
  TextField,
  type MapPoint,
} from '@/components';
import { JOB_STEP_MAX, VIDEO_MAX_SECONDS } from '@/constants/config';
import { usePresence } from '@/features/mechanic-presence';
import { useJob } from '@/hooks/queries';
import type { ChecklistItem, Job } from '@/models';
import { callPhone, openMapsSearch, openNavigation } from '@/services/location';
import { PermissionDeniedError, pickProof, VideoTooLargeError } from '@/services/media';
import { queryClient } from '@/services/query-client';
import { openReceipt, shareReceipt } from '@/services/receipt';
import { toast } from '@/store/toast';
import { Space, useColors } from '@/theme';
import { chooseProofSource, confirm } from '@/utils/confirm';
import { formatDate, formatUGX } from '@/utils/format';
import { distanceKm, etaMinutes, formatKm } from '@/utils/geo';
import { bookingDay, canFinish, computeTotals, parseFeedback, progress, statusLabel, vehicleLabel } from '@/utils/jobs';

/**
 * M3 En route (accepted SOS/diagnostic) or the quiet accepted-booking view → M4 Digital job card (fixing) →
 * completion summary. An open job that hasn't been accepted yet shows its details with an Accept button.
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
  // A booking waits for its day (the car is dropped off or collected); SOS and diagnostics go straight to the car.
  if (job.status === 'accepted' && job.scheduledDate) return <AcceptedBooking job={job} refetch={() => q.refetch()} />;
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

/** When a booking is: "Today", "Tomorrow" or the date. */
function bookedFor(date: string) {
  const d = bookingDay(date);
  return d === 'today' ? 'Today' : d === 'tomorrow' ? 'Tomorrow' : formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * An accepted booking. It stays quiet until its day (reminders the evening before and that morning): the date, the
 * car, how the owner hands it over (drop-off at the garage, or a pickup address with directions), the steps it will
 * start with, and the button that checks the car in when the mechanic has it.
 */
function AcceptedBooking({ job, refetch }: { job: Job; refetch: () => void }) {
  const c = useColors();
  const coords = usePresence((s) => s.coords);
  const [busy, setBusy] = useState(false);
  const o = job.owner;
  const who = o?.fullName?.split(' ')[0] ?? 'The owner';
  const h = job.handover;
  const day = bookingDay(job.scheduledDate!);
  // A pickup on its day: show the way there (the owner can follow the mechanic from now on).
  const pickupPoint = h?.mode === 'pickup' && h.pickupLat != null && h.pickupLng != null ? { lat: h.pickupLat, lng: h.pickupLng } : null;
  const showMap = !!pickupPoint && (day === 'today' || day === 'past');
  const points = [
    pickupPoint ? ({ ...pickupPoint, label: 'Pickup', kind: 'owner' } as MapPoint) : null,
    coords ? ({ ...coords, label: 'You', kind: 'me' } as MapPoint) : null,
  ].filter(Boolean) as MapPoint[];

  // Checks the car in: it's at the garage, or the mechanic has collected it. Before the booked day, confirm first.
  const start = async () => {
    if (day === 'later' || day === 'tomorrow') {
      const ok = await confirm('Start before the booked day?', `This booking is for ${bookedFor(job.scheduledDate!).toLowerCase()}. Start it now only if you already have the car.`, 'Start now');
      if (!ok) return;
    }
    setBusy(true);
    try {
      const updated = await api.markArrived(job.id);
      haptic('success');
      invalidate(job.id, updated);
      refetch();
    } catch (e) {
      toast({ title: 'Could not start', body: errorMessage(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      back
      title={job.serviceType}
      eyebrow={`Job #${job.id} · Booking`}
      footer={
        <Button
          title={h?.mode === 'pickup' ? 'I have collected the car · start' : 'Car is at my garage · start'}
          icon={CircleCheck}
          onPress={start}
          loading={busy}
          kind={day === 'today' || day === 'past' ? 'primary' : 'secondary'}
          haptic
        />
      }>
      <Card tone="dark" style={{ gap: 4 }}>
        <Row gap={Space.sm}>
          <CalendarClock size={20} color={c.primary} />
          <Text variant="label" style={{ color: '#cbd5e1' }}>
            Booked for
          </Text>
        </Row>
        <Text variant="title" style={{ color: '#fff' }}>
          {bookedFor(job.scheduledDate!)}
        </Text>
        {day === 'later' || day === 'tomorrow' ? (
          <Text style={{ color: '#cbd5e1' }}>We’ll remind you the evening before and that morning.</Text>
        ) : null}
      </Card>

      <Card style={{ gap: 4 }}>
        <Text variant="heading">{o?.fullName}</Text>
        <Text tone="textMuted">{job.vehicle ? `${vehicleLabel(job.vehicle)} ${job.vehicle.year} · ${job.vehicle.plateNumber}` : ''}</Text>
        {job.notes ? <Text variant="caption">“{job.notes}”</Text> : null}
      </Card>

      {!h ? (
        <InlineNotice tone="warning" icon={Clock}>
          Waiting for {who} to choose: bring the car to your garage, or have you collect it.
        </InlineNotice>
      ) : h.mode === 'drop_off' ? (
        <InlineNotice tone="info" icon={House}>
          {who} will bring the car to your garage.
        </InlineNotice>
      ) : (
        <Card style={{ gap: Space.sm }}>
          <Row gap={Space.sm}>
            <Truck size={18} color={c.primary} />
            <Text variant="bodyStrong">Collect the car from</Text>
          </Row>
          <Text>{h.pickupAddress}</Text>
          <Button
            title="Directions"
            icon={Navigation}
            kind="info"
            size="md"
            onPress={() => (h.pickupLat != null && h.pickupLng != null ? openNavigation(h.pickupLat, h.pickupLng) : openMapsSearch(h.pickupAddress ?? ''))}
          />
        </Card>
      )}
      {showMap && points.length ? <MapCard points={points} height={220} /> : null}

      <Button title={`Call ${who}`} icon={Phone} kind="secondary" size="md" onPress={() => callPhone(o?.phone)} disabled={!o?.phone} />

      <Section title={`Steps · ${(job.checklist ?? []).length}`}>
        <Card style={{ paddingVertical: Space.xs }}>
          {(job.checklist ?? []).map((t) => (
            <ChecklistRow key={t.id} item={t} />
          ))}
        </Card>
        <AddStep jobId={job.id} />
      </Section>
    </Screen>
  );
}

/** "Add a step" for steps this job needs beyond its service's usual ones. */
function AddStep({ jobId }: { jobId: number }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      await api.addTask(jobId, text);
      haptic('light');
      setText('');
      setOpen(false);
      invalidate(jobId);
    } catch (e) {
      toast({ title: 'Could not add the step', body: errorMessage(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  if (!open) return <Button title="Add a step" icon={ListPlus} kind="ghost" size="md" onPress={() => setOpen(true)} />;
  return (
    <Card style={{ gap: Space.sm }}>
      <TextField label="New step" value={text} onChangeText={setText} placeholder="e.g. Replace the fan belt" maxLength={JOB_STEP_MAX} autoFocus returnKeyType="done" onSubmitEditing={add} />
      <Row gap={Space.sm}>
        <Button title="Cancel" kind="ghost" size="md" style={{ flex: 1 }} onPress={() => setOpen(false)} />
        <Button title="Add step" size="md" style={{ flex: 1 }} onPress={add} loading={busy} disabled={text.trim().length < 3} />
      </Row>
    </Card>
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

  // Adds proof for a step (a photo, a short video, or one from the gallery), and marks the step done with it.
  const photo = async (t: ChecklistItem) => {
    try {
      const source = await chooseProofSource(`Proof · ${t.taskDescription}`, VIDEO_MAX_SECONDS);
      if (!source) return;
      // The step is remembered so a camera photo or video still reaches it if Android closes the app meanwhile.
      const proof = await pickProof(source, { kind: 'task', jobId: job.id, taskId: t.id, task: t.taskDescription });
      if (!proof) return;
      setBusyTask(t.id);
      const video = proof.type.startsWith('video/');
      if (video) toast({ title: 'Sending the video…', body: 'This can take a minute on mobile data. Keep the app open.', tone: 'info' });
      await api.updateTask(t.id, { isCompleted: true, photo: proof });
      haptic('success');
      if (video) toast({ title: 'Video sent', body: t.taskDescription, tone: 'success' });
      invalidate(job.id);
    } catch (e) {
      const title =
        e instanceof PermissionDeniedError ? 'Camera permission needed' : e instanceof VideoTooLargeError ? 'Video too long' : 'Could not save the proof';
      toast({ title, body: errorMessage(e), tone: 'danger' });
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
            <ChecklistRow key={t.id} item={t} onToggle={() => toggle(t)} onPhoto={() => photo(t)} disabled={busyTask === t.id} busy={busyTask === t.id} />
          ))}
        </Card>
        <Text variant="caption">Tap a step to tick it. Tap the camera for a photo or a short video as proof.</Text>
        <AddStep jobId={job.id} />
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
