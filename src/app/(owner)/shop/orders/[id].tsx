// Owner Shop: one order. Its progress (placed → confirmed → on the way / ready for pickup → delivered), items and
// totals, delivery or pickup details and payment; the owner can cancel while it's still waiting to be confirmed.
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { api } from '@/api';
import { errorMessage } from '@/api/errors';
import { Button, Card, Divider, ErrorState, InlineNotice, Row, Screen, Section, SkeletonList, Text } from '@/components';
import { Banknote, MapPin, Phone, Smartphone, X } from '@/components/icons';
import { ItemThumb, OrderStatusPill, OrderTimeline } from '@/features/shop-ui';
import { useConfig, useOrder } from '@/hooks/queries';
import type { Order } from '@/models';
import { queryClient } from '@/services/query-client';
import { toast } from '@/store/toast';
import { Space, useColors } from '@/theme';
import { confirm } from '@/utils/confirm';
import { formatDateTime, formatUGX } from '@/utils/format';

/** What happens next, in plain words, for each open status. */
function nextStep(o: Order, pickupLocation: string): string | null {
  switch (o.status) {
    case 'placed':
      return 'We’ll call you shortly to confirm the order.';
    case 'confirmed':
      return o.fulfilment === 'delivery' ? 'Your order is being packed for delivery.' : 'Your order is being prepared for pickup.';
    case 'out_for_delivery':
      return 'The rider is on the way. Keep your phone near you.';
    case 'ready_for_pickup':
      return `Ready at ${pickupLocation}. Bring your order number.`;
    default:
      return null;
  }
}

/** Order detail. Polls while the order is still open (status changes also arrive over the socket). */
export default function OrderDetail() {
  const c = useColors();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const config = useConfig();
  const q = useOrder(id, { live: true });
  const [cancelling, setCancelling] = useState(false);
  const o = q.data;

  const cancel = async () => {
    if (!o) return;
    if (!(await confirm('Cancel this order?', 'The items go back on sale. You can order again any time.', 'Cancel order', true))) return;
    setCancelling(true);
    try {
      const updated = await api.cancelOrder(o.id);
      queryClient.setQueryData(['shop', 'orders', o.id], updated);
      void queryClient.invalidateQueries({ queryKey: ['shop'] });
      toast({ title: 'Order cancelled', tone: 'info' });
    } catch (e) {
      // Most likely it was confirmed a moment ago; show the latest status.
      toast({ title: 'Could not cancel', body: errorMessage(e), tone: 'danger' });
      void q.refetch();
    } finally {
      setCancelling(false);
    }
  };

  if (!o) {
    return (
      <Screen back title="Order">
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <SkeletonList count={3} />}
      </Screen>
    );
  }

  const next = nextStep(o, config.pickupLocation);
  const PayIcon = o.paymentMethod === 'cash' ? Banknote : Smartphone;

  return (
    <Screen
      back
      title={`Order #${o.id}`}
      eyebrow={formatDateTime(o.createdAt)}
      right={<OrderStatusPill status={o.status} />}
      refreshing={q.isRefetching}
      onRefresh={() => q.refetch()}
      footer={
        o.status === 'placed' ? <Button title="Cancel order" icon={X} kind="outline" onPress={cancel} loading={cancelling} /> : undefined
      }>
      <Card style={{ gap: Space.md }}>
        <OrderTimeline order={o} />
        {next ? <Text tone="textMuted">{next}</Text> : null}
      </Card>

      <Section title="Items">
        <Card style={{ gap: Space.sm }}>
          {o.items.map((it, i) => (
            <View key={`${it.productId}-${i}`}>
              {i ? <Divider /> : null}
              <Row gap={Space.md} style={{ paddingVertical: 4 }}>
                <ItemThumb uri={it.photo} size={44} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong" numberOfLines={2}>
                    {it.name}
                  </Text>
                  <Text variant="caption">
                    {it.quantity} × {formatUGX(it.unitPrice)}
                  </Text>
                </View>
                <Text variant="bodyStrong">{formatUGX(it.unitPrice * it.quantity)}</Text>
              </Row>
            </View>
          ))}
          <Divider />
          <Row style={{ justifyContent: 'space-between' }}>
            <Text tone="textMuted">Items</Text>
            <Text>{formatUGX(o.subtotal)}</Text>
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text tone="textMuted">Delivery</Text>
            <Text>{o.deliveryFee ? formatUGX(o.deliveryFee) : 'Free'}</Text>
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="bodyStrong">Total</Text>
            <Text variant="heading">{formatUGX(o.total)}</Text>
          </Row>
        </Card>
      </Section>

      <Section title={o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}>
        <Card style={{ gap: Space.sm }}>
          <Row gap={Space.sm} style={{ alignItems: 'flex-start' }}>
            <MapPin size={18} color={c.textMuted} />
            <Text style={{ flex: 1 }}>{o.fulfilment === 'delivery' ? (o.deliveryAddress ?? '—') : config.pickupLocation}</Text>
          </Row>
          <Row gap={Space.sm}>
            <Phone size={18} color={c.textMuted} />
            <Text style={{ flex: 1 }}>{o.contactPhone}</Text>
          </Row>
          <Row gap={Space.sm}>
            <PayIcon size={18} color={c.textMuted} />
            <Text style={{ flex: 1 }}>
              {o.paymentMethod === 'cash' ? 'Cash' : 'Mobile money'} {o.fulfilment === 'delivery' ? 'on delivery' : 'at pickup'}
            </Text>
          </Row>
          {o.note ? <Text variant="caption">Note: {o.note}</Text> : null}
        </Card>
      </Section>

      {o.status === 'delivered' ? (
        <InlineNotice tone="success">Delivered. Thank you for buying genuine parts from MyCarRepair.</InlineNotice>
      ) : null}
    </Screen>
  );
}
