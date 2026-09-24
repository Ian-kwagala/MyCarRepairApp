import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarDays, Phone, Receipt, Siren, Star } from '@/components/icons';
import { useState } from 'react';
import { View } from 'react-native';

import { api } from '@/api';
import { errorMessage } from '@/api/errors';
import {
  Avatar,
  Button,
  Card,
  ChecklistRow,
  Divider,
  ErrorState,
  InlineNotice,
  MapCard,
  ProgressBar,
  QuoteCard,
  Row,
  Screen,
  Section,
  SkeletonList,
  StageTimeline,
  Text,
  type MapPoint,
} from '@/components';
import { useJob } from '@/hooks/queries';
import { callPhone } from '@/services/location';
import { queryClient } from '@/services/query-client';
import { toast } from '@/store/toast';
import { Space, useColors } from '@/theme';
import { confirm } from '@/utils/confirm';
import { formatDate, formatUGX } from '@/utils/format';
import { computeTotals, isActive, pendingQuotes, progress, statusLabel } from '@/utils/jobs';

/** O9 Live repair tracker — 5-stage timeline, live checklist, pending quotes → O10. */
export default function Tracker() {
  const c = useColors();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const q = useJob(id, { live: true });
  const [cancelling, setCancelling] = useState(false);
  const job = q.data;

  if (!job) {
    return (
      <Screen back title="Repair">
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <SkeletonList count={4} />}
      </Screen>
    );
  }

  const pr = progress(job.checklist);
  const waiting = pendingQuotes(job);
  const decided = (job.quotes ?? []).filter((x) => x.isApproved !== null);
  const totals = job.totals ?? computeTotals(job.quotes);
  const mech = job.mechanic;
  const enRoute = job.status === 'accepted';
  const points = [
    job.owner?.locationLat != null && job.owner.locationLng != null && job.sosActive
      ? ({ lat: job.owner.locationLat, lng: job.owner.locationLng, label: 'Your car', kind: 'me' } as MapPoint)
      : null,
    mech?.locationLat != null && mech.locationLng != null ? ({ lat: mech.locationLat, lng: mech.locationLng, label: mech.fullName, kind: 'mechanic' } as MapPoint) : null,
  ].filter(Boolean) as MapPoint[];

  const cancel = async () => {
    if (!(await confirm('Cancel this request?', 'Mechanics will no longer see it.', 'Cancel request', true))) return;
    setCancelling(true);
    try {
      await api.cancelSos(id);
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void q.refetch();
      toast({ title: 'Request cancelled', tone: 'info' });
    } catch (e) {
      toast({ title: 'Could not cancel', body: errorMessage(e), tone: 'danger' });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Screen
      back
      title={job.serviceType}
      eyebrow={`Job #${job.id} · ${statusLabel(job.status)}`}
      refreshing={q.isRefetching}
      onRefresh={() => q.refetch()}
      footer={
        job.status === 'completed' ? (
          <Button title={job.review ? 'View receipt' : 'View receipt & rate'} icon={Receipt} onPress={() => router.push(`/job/${id}/receipt`)} />
        ) : mech?.phone && isActive(job.status) ? (
          <Row gap={Space.sm}>
            <Button title="Call mechanic" icon={Phone} kind="secondary" style={{ flex: 1 }} onPress={() => callPhone(mech.phone)} />
          </Row>
        ) : undefined
      }>
      {job.status === 'cancelled' ? (
        <InlineNotice tone="warning">This request was cancelled.</InlineNotice>
      ) : (
        <Card style={{ gap: Space.md }}>
          <StageTimeline job={job} />
          {pr.total && job.status !== 'pending' && job.status !== 'accepted' ? (
            <View style={{ gap: 6 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="label">Progress</Text>
                <Text variant="bodyStrong">{pr.pct}%</Text>
              </Row>
              <ProgressBar pct={pr.pct} color={c.success} />
            </View>
          ) : null}
        </Card>
      )}

      {job.status === 'pending' ? (
        <Card style={{ gap: Space.sm }}>
          <Text variant="heading">{job.sosActive ? 'Finding a mechanic…' : 'Waiting for a mechanic to accept'}</Text>
          {job.scheduledDate ? (
            <Row gap={6}>
              <CalendarDays size={16} color={c.textMuted} />
              <Text tone="textMuted">For {formatDate(job.scheduledDate, { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
            </Row>
          ) : null}
          {job.notes ? <Text tone="textMuted">“{job.notes}”</Text> : null}
          <Text variant="caption">We will notify you as soon as a mechanic accepts.</Text>
          {job.sosActive ? (
            <Button title="Open SOS screen" icon={Siren} kind="danger" size="md" onPress={() => router.replace(`/sos/${id}`)} />
          ) : null}
          <Button title="Cancel request" kind="ghost" size="md" onPress={cancel} loading={cancelling} />
        </Card>
      ) : null}

      {mech ? (
        <Card>
          <Row gap={Space.md}>
            <Avatar name={mech.fullName} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{mech.fullName}</Text>
              <Row gap={4}>
                <Star size={13} color="#f59e0b" fill="#f59e0b" />
                <Text variant="caption">
                  {mech.rating ? mech.rating.toFixed(1) : 'New'}
                  {mech.garageName ? ` · ${mech.garageName}` : ''}
                </Text>
              </Row>
            </View>
            {mech.phone && isActive(job.status) ? <Button title="Call" icon={Phone} size="sm" kind="secondary" onPress={() => callPhone(mech.phone)} /> : null}
          </Row>
        </Card>
      ) : null}

      {enRoute && points.length ? <MapCard points={points} /> : null}

      {waiting.length ? (
        <Section title="Parts awaiting you" style={{ marginTop: Space.sm }}>
          {waiting.map((qt) => (
            <QuoteCard key={qt.id} quote={qt} onPress={() => router.push({ pathname: '/quote/[id]', params: { id: String(qt.id), jobId: String(id) } })} />
          ))}
        </Section>
      ) : null}

      {job.checklist?.length ? (
        <Section title={`Checklist · ${pr.done}/${pr.total}`}>
          <Card style={{ paddingVertical: Space.xs }}>
            {job.checklist.map((t) => (
              <ChecklistRow key={t.id} item={t} />
            ))}
          </Card>
        </Section>
      ) : null}

      {decided.length ? (
        <Section title="Parts">
          {decided.map((qt) => (
            <QuoteCard key={qt.id} quote={qt} />
          ))}
        </Section>
      ) : null}

      {job.status !== 'pending' && job.status !== 'cancelled' ? (
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
            <Text variant="bodyStrong">{job.status === 'completed' ? 'Total paid' : 'Current total'}</Text>
            <Text variant="heading">{formatUGX(job.status === 'completed' ? job.totalPrice || totals.total : totals.total)}</Text>
          </Row>
        </Card>
      ) : null}

      {job.vehicle ? (
        <Row gap={Space.md} style={{ marginTop: Space.sm }}>
          {job.vehicle.photos[0] ? <Image source={{ uri: job.vehicle.photos[0] }} style={{ width: 44, height: 44, borderRadius: 10 }} /> : null}
          <Text variant="caption">
            {job.vehicle.make} {job.vehicle.model} · {job.vehicle.plateNumber} · requested {formatDate(job.createdAt)}
          </Text>
        </Row>
      ) : null}
    </Screen>
  );
}
