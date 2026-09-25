import { Star } from '@/components/icons';
import { View } from 'react-native';

import { Card, EmptyState, ErrorState, Row, Screen, SkeletonList, Stars, Text } from '@/components';
import { useMyReviews } from '@/hooks/queries';
import { Space } from '@/theme';
import { formatDate } from '@/utils/format';
import { parseFeedback } from '@/utils/jobs';

// Mechanic screen listing the reviews owners have left.

/** Mechanic reviews — visible reputation. Average rating on top, then each review, newest first. */
export default function Reviews() {
  const q = useMyReviews();
  return (
    <Screen back title="My reviews" refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      {q.isLoading ? (
        <SkeletonList />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.count ? (
        <EmptyState icon={Star} title="No reviews yet" body="Owners rate each job after it is complete." />
      ) : (
        <>
          <Card tone="dark" style={{ alignItems: 'center', gap: Space.sm }}>
            <Text variant="display" style={{ color: '#fff' }}>
              {q.data.average.toFixed(1)}
            </Text>
            <Stars value={Math.round(q.data.average)} size={24} />
            <Text style={{ color: '#cbd5e1' }}>
              {q.data.count} review{q.data.count > 1 ? 's' : ''}
            </Text>
          </Card>
          {q.data.reviews.map((r) => {
            // Split the stored feedback into quick tags and the free-text comment.
            const fb = parseFeedback(r.feedback);
            return (
              <Card key={r.id} style={{ gap: 6 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text variant="bodyStrong">{r.ownerName}</Text>
                  <Stars value={r.rating} size={16} />
                </Row>
                <Text variant="caption">
                  {r.serviceType} · {formatDate(r.createdAt)}
                </Text>
                {fb.tags.length ? <Text variant="bodyStrong" tone="primary">{fb.tags.join(' · ')}</Text> : null}
                {fb.comment ? (
                  <View>
                    <Text>{fb.comment}</Text>
                  </View>
                ) : null}
              </Card>
            );
          })}
        </>
      )}
    </Screen>
  );
}
