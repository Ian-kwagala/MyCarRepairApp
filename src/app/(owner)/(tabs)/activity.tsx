import { router } from 'expo-router';
import { ClipboardList } from '@/components/icons';
import { useState } from 'react';

import { EmptyState, ErrorState, JobListItem, Screen, Section, Segmented, SkeletonList } from '@/components';
import { useJobs } from '@/hooks/queries';
import type { Job } from '@/models';
import { groupByDate } from '@/utils/format';

/** O12 Activity — active vs history, grouped by date (Today … Older). Cached for offline viewing. */
export default function ActivityTab() {
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const active = useJobs('active', { live: tab === 'active' });
  const history = useJobs('history');
  const q = tab === 'active' ? active : history;
  const groups = groupByDate(q.data ?? [], (j) => j.createdAt);

  const open = (j: Job) => {
    if (j.sosActive && j.status === 'pending') router.push(`/sos/${j.id}`);
    else if (j.status === 'completed') router.push(`/job/${j.id}/receipt`);
    else router.push(`/job/${j.id}`);
  };

  return (
    <Screen
      title="Activity"
      eyebrow="Bookings & history"
      inTabs
      refreshing={q.isRefetching}
      onRefresh={() => q.refetch()}>
      <Segmented
        options={['active', 'history'] as const}
        value={tab}
        onChange={setTab}
        labels={{ active: 'Active', history: 'History' }}
        counts={{ active: active.data?.length, history: history.data?.length }}
      />
      {q.isLoading ? (
        <SkeletonList />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={tab === 'active' ? 'No active jobs' : 'No history yet'}
          body={tab === 'active' ? 'Bookings, diagnostics and SOS requests in progress appear here.' : 'Completed and cancelled jobs appear here.'}
        />
      ) : (
        groups.map((g, i) => (
          <Section key={g.title} title={g.title} style={i === 0 ? { marginTop: 0 } : undefined}>
            {g.data.map((j) => (
              <JobListItem key={j.id} job={j} onPress={() => open(j)} />
            ))}
          </Section>
        ))
      )}
    </Screen>
  );
}
