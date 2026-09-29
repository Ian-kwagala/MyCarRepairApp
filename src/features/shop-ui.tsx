// Building blocks for the owner's Shop screens (marketplace of genuine parts and accessories): product cards,
// the quantity stepper, order status pills and cards, the order progress timeline and the header cart button.
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, IconButton, Row, StatusPill, Text } from '@/components';
import { Check, Minus, Package, Plus, ShieldCheck, ShoppingCart } from '@/components/icons';
import type { Order, OrderStatus, Product } from '@/models';
import { useCartCount } from '@/store/cart';
import { Font, Radius, Space, Touch, useColors } from '@/theme';
import { formatDate, formatUGX } from '@/utils/format';
import { orderStatusLabel, orderStatusTone, orderSteps } from '@/utils/shop';

/** Grid card for a product: photo, name, brand, price, and a sold-out or warranty tag. */
export function ProductCard({ product }: { product: Product }) {
  const c = useColors();
  const soldOut = product.stock <= 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${formatUGX(product.price)}${soldOut ? ', sold out' : ''}`}
      onPress={() => router.push(`/shop/${product.id}`)}
      style={({ pressed }) => [styles.card, { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.9 : 1 }]}>
      <View style={[styles.photoBox, { backgroundColor: c.surfaceAlt }]}>
        {product.photos[0] ? (
          <Image source={{ uri: product.photos[0] }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
        ) : (
          <Package size={32} color={c.textSubtle} />
        )}
        {soldOut ? (
          <View style={[styles.tag, { backgroundColor: c.danger }]}>
            <Text style={styles.tagText}>Sold out</Text>
          </View>
        ) : null}
      </View>
      <View style={{ padding: Space.sm, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {product.name}
        </Text>
        {product.brand ? (
          <Text variant="caption" numberOfLines={1}>
            {product.brand}
          </Text>
        ) : null}
        <Text style={{ fontFamily: Font.bold, fontSize: 15, color: c.text, marginTop: 2 }}>{formatUGX(product.price)}</Text>
      </View>
    </Pressable>
  );
}

/** "Genuine · 6-month warranty" line shown on product pages. */
export function GenuineBadge({ warrantyMonths }: { warrantyMonths: number | null }) {
  const c = useColors();
  return (
    <Row gap={6}>
      <ShieldCheck size={16} color={c.success} />
      <Text variant="caption" style={{ color: c.success, fontFamily: Font.semibold }}>
        Genuine, sold by MyCarRepair{warrantyMonths ? ` · ${warrantyMonths}-month warranty` : ''}
      </Text>
    </Row>
  );
}

/** − n + stepper; `max` caps it (stock or the per-order limit). */
export function QuantityStepper({ value, onChange, max, min = 1 }: { value: number; onChange: (v: number) => void; max: number; min?: number }) {
  const c = useColors();
  return (
    <View style={[styles.stepper, { borderColor: c.border, backgroundColor: c.surface }]}>
      {/* At a limit the button stays visible but greyed out and does nothing. */}
      <IconButton icon={Minus} label="Fewer" onPress={value > min ? () => onChange(value - 1) : undefined} color={value > min ? c.text : c.textSubtle} />
      <Text variant="bodyStrong" style={{ minWidth: 28, textAlign: 'center' }} accessibilityLabel={`Quantity ${value}`}>
        {value}
      </Text>
      <IconButton icon={Plus} label="More" onPress={value < max ? () => onChange(value + 1) : undefined} color={value < max ? c.text : c.textSubtle} />
    </View>
  );
}

/** Pill with an order's status in plain words. */
export function OrderStatusPill({ status }: { status: OrderStatus }) {
  return <StatusPill label={orderStatusLabel(status)} tone={orderStatusTone(status)} />;
}

/** Order summary card for lists; opens the order. */
export function OrderCard({ order }: { order: Order }) {
  const items = order.items.reduce((n, i) => n + i.quantity, 0);
  const first = order.items[0];
  return (
    <Card onPress={() => router.push(`/shop/orders/${order.id}`)} accessibilityLabel={`Order ${order.id}, ${orderStatusLabel(order.status)}`}>
      <Row gap={Space.md}>
        <ItemThumb uri={first?.photo ?? null} />
        <View style={{ flex: 1, gap: 2 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="bodyStrong">Order #{order.id}</Text>
            <OrderStatusPill status={order.status} />
          </Row>
          <Text variant="caption" numberOfLines={1}>
            {first?.name}
            {items > 1 ? ` + ${items - 1} more` : ''}
          </Text>
          <Text variant="caption">
            {formatDate(order.createdAt)} · {formatUGX(order.total)}
          </Text>
        </View>
      </Row>
    </Card>
  );
}

/** Small square photo for order lines (placeholder when the product has no photo any more). */
export function ItemThumb({ uri, size = 52 }: { uri: string | null; size?: number }) {
  const c = useColors();
  return (
    <View style={[styles.thumb, { width: size, height: size, backgroundColor: c.surfaceAlt }]}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors /> : <Package size={20} color={c.textSubtle} />}
    </View>
  );
}

/** Where an order is: placed → confirmed → on the way / ready for pickup → delivered (or cancelled). */
export function OrderTimeline({ order }: { order: Order }) {
  const c = useColors();
  if (order.status === 'cancelled') {
    return <Text tone="textMuted">This order was cancelled. Nothing will be charged.</Text>;
  }
  const steps = orderSteps(order.fulfilment);
  const at = steps.indexOf(order.status);
  return (
    <View style={{ gap: Space.sm }}>
      {steps.map((s, i) => {
        const done = i <= at;
        return (
          <Row key={s} gap={Space.md}>
            <View style={[styles.dot, { backgroundColor: done ? c.success : c.surface, borderColor: done ? c.success : c.border }]}>
              {done ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
            </View>
            <Text style={{ fontFamily: i === at ? Font.bold : Font.medium, color: done ? c.text : c.textSubtle }}>{orderStatusLabel(s)}</Text>
          </Row>
        );
      })}
    </View>
  );
}

/** Header cart button with the item count; opens the cart. */
export function CartButton({ color }: { color?: string }) {
  const count = useCartCount();
  return <IconButton icon={ShoppingCart} label={count ? `Cart, ${count} items` : 'Cart'} onPress={() => router.push('/shop/cart')} color={color} badge={count || undefined} />;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radius.card, overflow: 'hidden', flex: 1 },
  photoBox: { aspectRatio: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tag: { position: 'absolute', top: Space.sm, left: Space.sm, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  tagText: { color: '#fff', fontFamily: Font.bold, fontSize: 11 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: Radius.button, minHeight: Touch.min, paddingHorizontal: 2 },
  thumb: { borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  dot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
