// Owner Shop: "My orders", every marketplace order the owner has placed, newest first, with its live status.
import { router } from 'expo-router';

import { Button, EmptyState, ErrorState, Screen, SkeletonList } from '@/components';
import { ReceiptText } from '@/components/icons';
import { OrderCard } from '@/features/shop-ui';
import { useOrders } from '@/hooks/queries';

/** My orders. Polls while open (status changes also arrive over the socket). */
export default function MyOrders() {
  const q = useOrders({ live: true });
  const list = q.data ?? [];
  return (
    <Screen back title="My orders" eyebrow="Shop" refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      {q.isLoading ? (
        <SkeletonList count={4} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title="No orders yet"
          body="Orders you place in the Shop show here, with their delivery status."
          action={<Button title="Browse the shop" onPress={() => router.replace('/shop')} />}
        />
      ) : (
        list.map((o) => <OrderCard key={o.id} order={o} />)
      )}
    </Screen>
  );
}
