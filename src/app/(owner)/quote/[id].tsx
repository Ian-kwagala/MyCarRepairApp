import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, X } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';

import { api } from '@/api';
import { errorMessage } from '@/api/errors';
import { Button, Card, Divider, ErrorState, haptic, QuoteStatus, Row, Screen, SkeletonList, Text } from '@/components';
import { useQuoteWithJob } from '@/features/use-quote';
import { useConfig } from '@/hooks/queries';
import { queryClient } from '@/services/query-client';
import { toast } from '@/store/toast';
import { Space, useColors } from '@/theme';
import { confirm } from '@/utils/confirm';
import { formatUGX } from '@/utils/format';
import { computeTotals } from '@/utils/jobs';

/** O10 Parts approval — decide before purchase. Shows the new total if approved. Decision is final. */
export default function QuoteSheet() {
  const c = useColors();
  const { width } = useWindowDimensions();
  const config = useConfig();
  const params = useLocalSearchParams<{ id: string; jobId?: string }>();
  const quoteId = Number(params.id);
  const q = useQuoteWithJob(quoteId, params.jobId ? Number(params.jobId) : undefined);
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (!q.data) {
    return (
      <Screen back={close} title="Part quote">
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <SkeletonList count={3} />}
      </Screen>
    );
  }

  const { job, quote } = q.data;
  const totals = computeTotals(job.quotes, job.totals?.serviceFee ?? config.serviceFee);
  const newTotal = totals.total + (quote.isApproved === null ? quote.price : 0);

  const decide = async (decision: 'approve' | 'reject') => {
    const ok = await confirm(
      decision === 'approve' ? 'Approve this part?' : 'Decline this part?',
      decision === 'approve'
        ? `${quote.partName} · ${formatUGX(quote.price)} will be added to your bill. This decision is final.`
        : `${quote.partName} will not be fitted or billed. This decision is final.`,
      decision === 'approve' ? 'Approve' : 'Decline',
      decision === 'reject',
    );
    if (!ok) return;
    setBusy(decision);
    try {
      await api.decideQuote(quote.id, decision);
      haptic('success');
      await queryClient.invalidateQueries({ queryKey: ['job', job.id] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast({ title: decision === 'approve' ? 'Part approved' : 'Part declined', body: quote.partName, tone: decision === 'approve' ? 'success' : 'info' });
      close();
    } catch (e) {
      toast({ title: 'Could not save decision', body: errorMessage(e), tone: 'danger' });
      void q.refetch();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen
      back={close}
      title={job.serviceType}
      eyebrow={`Job #${job.id}`}
      footer={
        quote.isApproved === null ? (
          <Row gap={Space.sm}>
            <Button title="Decline" icon={X} kind="secondary" style={{ flex: 1 }} onPress={() => decide('reject')} loading={busy === 'reject'} disabled={!!busy} />
            <Button title="Approve" icon={Check} kind="success" style={{ flex: 1 }} onPress={() => decide('approve')} loading={busy === 'approve'} disabled={!!busy} />
          </Row>
        ) : (
          <Button title="Done" kind="secondary" onPress={close} />
        )
      }>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="label">New part quote</Text>
        <QuoteStatus quote={quote} />
      </Row>
      {quote.photos.length ? (
        <View style={{ gap: 6 }}>
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -Space.lg }}>
            {quote.photos.map((p, i) => (
              <Image key={`${p}-${i}`} source={{ uri: p }} style={{ width, height: 240, backgroundColor: c.surfaceAlt }} contentFit="cover" accessibilityLabel={`Part photo ${i + 1}`} />
            ))}
          </ScrollView>
          <Text variant="caption">
            {quote.photos.length} photo{quote.photos.length > 1 ? 's' : ''} · swipe to see all
          </Text>
        </View>
      ) : null}
      <Text variant="title">{quote.partName}</Text>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text tone="textMuted">Quoted by {job.mechanic?.fullName ?? 'your mechanic'}</Text>
        <Text variant="heading" tone="primary">
          {formatUGX(quote.price)}
        </Text>
      </Row>
      <Card style={{ gap: Space.sm }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text tone="textMuted">Service fee</Text>
          <Text>{formatUGX(totals.serviceFee, false)}</Text>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text tone="textMuted">Approved parts</Text>
          <Text>{formatUGX(totals.approvedParts, false)}</Text>
        </Row>
        <Divider />
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="bodyStrong">{quote.isApproved === null ? 'New total if approved' : 'Current total'}</Text>
          <Text variant="heading">{formatUGX(quote.isApproved === null ? newTotal : totals.total)}</Text>
        </Row>
      </Card>
      <Text variant="caption">Nothing is billed unless you approve it. Ask your mechanic to show you the old part.</Text>
    </Screen>
  );
}
