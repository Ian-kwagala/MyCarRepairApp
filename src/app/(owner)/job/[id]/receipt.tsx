import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheck, FileText, Share2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { api } from '@/api';
import { errorMessage } from '@/api/errors';
import { Button, Card, Chip, ErrorState, haptic, InlineNotice, Row, Screen, Section, SkeletonList, Stars, Text, TextField } from '@/components';
import { REVIEW_TAGS } from '@/constants/config';
import { useJob } from '@/hooks/queries';
import { queryClient } from '@/services/query-client';
import { openReceipt, shareReceipt } from '@/services/receipt';
import { toast } from '@/store/toast';
import { Space, useColors } from '@/theme';
import { firstName, formatDateTime, formatUGX } from '@/utils/format';
import { computeTotals, parseFeedback } from '@/utils/jobs';

// Owner's receipt and review screen for a completed job.

/**
 * O11 Receipt & rating — pay summary, PDF (open/share), 1–5 stars + quick tags (1 review per job).
 * After reviewing, the form is replaced by the submitted review.
 */
export default function ReceiptScreen() {
  const c = useColors();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const q = useJob(id);
  // Review form state (0 = no stars picked yet).
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<'open' | 'share' | null>(null);
  const job = q.data;

  if (!job) {
    return (
      <Screen back title="Receipt">
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <SkeletonList count={3} />}
      </Screen>
    );
  }

  if (job.status !== 'completed') {
    return (
      <Screen back title="Receipt">
        <InlineNotice tone="info">The receipt is ready once the job is complete.</InlineNotice>
        <Button title="Open repair tracker" onPress={() => router.replace(`/job/${id}`)} />
      </Screen>
    );
  }

  const totals = job.totals ?? computeTotals(job.quotes);
  // Prefer the price saved at completion over a recalculation.
  const total = job.totalPrice || totals.total;
  const mechName = firstName(job.mechanic?.fullName) || 'your mechanic';
  // The submitted review split back into tags and comment, for display.
  const existing = job.review ? parseFeedback(job.review.feedback) : null;

  // Opens or shares the PDF receipt.
  const pdf = async (kind: 'open' | 'share') => {
    setPdfBusy(kind);
    try {
      if (kind === 'open') await openReceipt(id);
      else await shareReceipt(id);
    } catch (e) {
      toast({ title: 'Receipt unavailable', body: errorMessage(e), tone: 'danger' });
    } finally {
      setPdfBusy(null);
    }
  };

  // Sends the review; the refetched job then includes it, which swaps the form for the review.
  const submit = async () => {
    if (!rating) return toast({ title: 'Pick a star rating', tone: 'warning' });
    setSaving(true);
    try {
      await api.submitReview(id, { rating: rating as 1 | 2 | 3 | 4 | 5, feedback: comment, tags });
      haptic('success');
      await queryClient.invalidateQueries({ queryKey: ['job', id] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast({ title: 'Thanks for your review', tone: 'success' });
    } catch (e) {
      toast({ title: 'Could not submit review', body: errorMessage(e), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      back
      title="Job complete"
      eyebrow={`${job.serviceType} · ${job.vehicle?.plateNumber ?? ''}`}
      footer={!job.review ? <Button title="Submit review" onPress={submit} loading={saving} disabled={!rating} /> : undefined}>
      <Card tone="dark" style={{ alignItems: 'center', gap: 4 }}>
        <CircleCheck size={32} color={c.success} />
        <Text variant="label" style={{ color: '#cbd5e1' }}>
          Total paid
        </Text>
        <Text variant="display" style={{ color: '#fff' }}>
          {formatUGX(total)}
        </Text>
        <Text style={{ color: '#cbd5e1' }}>
          Fee {formatUGX(totals.serviceFee, false)} · Parts {formatUGX(totals.approvedParts, false)}
        </Text>
        <Text variant="caption" style={{ color: '#94a3b8' }}>
          {formatDateTime(job.updatedAt)}
        </Text>
      </Card>
      <Row gap={Space.sm}>
        <Button title="Receipt PDF" icon={FileText} kind="secondary" size="md" style={{ flex: 1 }} onPress={() => pdf('open')} loading={pdfBusy === 'open'} />
        <Button title="Share" icon={Share2} kind="secondary" size="md" style={{ flex: 1 }} onPress={() => pdf('share')} loading={pdfBusy === 'share'} />
      </Row>

      {job.review && existing ? (
        <Section title="Your review">
          <Card style={{ gap: Space.sm }}>
            <Stars value={job.review.rating} size={24} />
            {existing.tags.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm }}>
                {existing.tags.map((t) => (
                  <Chip key={t} label={t} selected />
                ))}
              </View>
            ) : null}
            {existing.comment ? <Text>{existing.comment}</Text> : null}
          </Card>
        </Section>
      ) : (
        <Section title={`How was ${mechName}?`}>
          <Row style={{ justifyContent: 'center', paddingVertical: Space.sm }}>
            <Stars value={rating} onChange={setRating} size={42} />
          </Row>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm }}>
            {REVIEW_TAGS.map((t) => (
              <Chip key={t} label={t} selected={tags.includes(t)} onPress={() => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))} />
            ))}
          </View>
          <TextField label="Comment (optional)" value={comment} onChangeText={setComment} placeholder="Add a comment…" multiline maxLength={500} />
        </Section>
      )}
    </Screen>
  );
}
