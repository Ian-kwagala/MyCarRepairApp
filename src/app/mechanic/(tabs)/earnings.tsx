import { router } from 'expo-router';
import { Wallet } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import type { EarningsRange } from '@/api';
import { BarChart, Card, EmptyState, ErrorState, Row, Screen, Section, Segmented, SkeletonList, StatTile, Text } from '@/components';
import { useEarnings } from '@/hooks/queries';
import { Space } from '@/theme';
import { compactUGX, formatDate, formatUGX } from '@/utils/format';

/** M6 Earnings — today, week/month bars, recent payouts. MoMo withdrawal is Phase 2 (hidden). */
export default function Earnings() {
  const [range, setRange] = useState<Exclude<EarningsRange, 'day'>>('week');
  const q = useEarnings(range);
  const e = q.data;
  return (
    <Screen title="Earnings" inTabs refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      {q.isLoading ? (
        <SkeletonList count={3} height={120} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : e ? (
        <>
          <Card tone="dark" style={{ gap: 4 }}>
            <Text variant="label" style={{ color: '#94a3b8' }}>
              Earned today
            </Text>
            <Text variant="display" style={{ color: '#fff' }}>
              {formatUGX(e.today)}
            </Text>
            <Text style={{ color: '#cbd5e1' }}>
              {range === 'week' ? 'This week' : 'Last 6 months'} · {formatUGX(e.total)}
            </Text>
          </Card>
          <Segmented options={['week', 'month'] as const} value={range} onChange={setRange} labels={{ week: 'This week', month: 'Monthly' }} />
          <Card>
            <BarChart data={e.series} />
          </Card>
          <Row gap={Space.md}>
            <StatTile value={String(e.jobs)} label="Jobs" />
            <StatTile value={e.jobs ? compactUGX(Math.round(e.total / e.jobs)) : '—'} label="Avg job" />
          </Row>
          <Section title="Recent payouts">
            {e.payouts.length ? (
              <Card style={{ paddingVertical: Space.xs }}>
                {e.payouts.map((p, i) => (
                  <View key={p.jobId}>
                    <Row
                      style={{ justifyContent: 'space-between', paddingVertical: Space.md, borderTopWidth: i ? 0.5 : 0, borderColor: '#cbd5e1' }}>
                      <View style={{ flex: 1 }}>
                        <Text variant="bodyStrong" onPress={() => router.push(`/mechanic/job/${p.jobId}`)}>
                          {p.serviceType}
                        </Text>
                        <Text variant="caption">
                          {p.vehicle} · #{p.jobId} · {formatDate(p.date)}
                        </Text>
                      </View>
                      <Text variant="bodyStrong" tone="success">
                        {formatUGX(p.amount, false)}
                      </Text>
                    </Row>
                  </View>
                ))}
              </Card>
            ) : (
              <EmptyState icon={Wallet} title="No payouts yet" body="Completed jobs and their totals appear here." />
            )}
          </Section>
          <Text variant="caption" center>
            Withdraw to Mobile Money (MTN MoMo / Airtel Money) arrives in Phase 2.
          </Text>
        </>
      ) : null}
    </Screen>
  );
}
