// Owner Shop: one product's page. Photos, price, genuine/warranty line, part number, which cars it fits, the
// description and stock, with a quantity stepper and "Add to cart".
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';

import { Button, Card, Divider, ErrorState, haptic, InlineNotice, Row, Screen, SkeletonList, StatusPill, Text } from '@/components';
import { Package, ShoppingCart } from '@/components/icons';
import { MAX_ORDER_QUANTITY } from '@/constants/config';
import { CartButton, GenuineBadge, QuantityStepper } from '@/features/shop-ui';
import { useProduct } from '@/hooks/queries';
import { useCart } from '@/store/cart';
import { useUser } from '@/store/session';
import { toast } from '@/store/toast';
import { Font, Space, useColors } from '@/theme';
import { formatUGX } from '@/utils/format';
import { categoryLabel } from '@/utils/shop';

/** Product detail — opened from a Shop card. */
export default function ProductDetail() {
  const c = useColors();
  const { width } = useWindowDimensions();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const q = useProduct(id);
  const user = useUser();
  const loadCart = useCart((s) => s.load);
  const add = useCart((s) => s.add);
  const inCart = useCart((s) => s.lines.find((l) => l.productId === id)?.quantity ?? 0);
  const [qty, setQty] = useState(1);
  const p = q.data;

  // Deep links (e.g. from a notification) can land here before the Shop tab has loaded the cart.
  useEffect(() => {
    if (user) void loadCart(user.id);
  }, [user, loadCart]);

  if (!p) {
    return (
      <Screen back title="Product">
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <SkeletonList count={2} height={220} />}
      </Screen>
    );
  }

  // How many more can go in the cart: limited by stock, the per-order cap, and what's already in it.
  const room = Math.max(0, Math.min(p.stock, MAX_ORDER_QUANTITY) - inCart);
  const soldOut = p.stock <= 0;
  const amount = Math.min(qty, room);

  const addToCart = () => {
    if (!amount) return;
    add(p, amount);
    haptic('success');
    toast({ title: 'Added to cart', body: `${amount} × ${p.name}`, tone: 'success' });
    setQty(1);
  };

  // [label, value] rows for the details card; empty values are left out.
  const details: [string, string][] = (
    [
      ['Section', categoryLabel(p.category)],
      ['Sold by', p.seller?.shopName ?? 'MyCarRepair'],
      ['Brand', p.brand ?? ''],
      ['Part number', p.partNumber ?? ''],
      ['Fits', p.compatibleWith || 'Most cars'],
      ['Warranty', p.warrantyMonths ? `${p.warrantyMonths} months` : ''],
    ] as [string, string][]
  ).filter(([, v]) => v);

  return (
    <Screen
      back
      title={p.name}
      eyebrow={categoryLabel(p.category)}
      right={<CartButton />}
      refreshing={q.isRefetching}
      onRefresh={() => q.refetch()}
      footer={
        soldOut ? (
          <Button title="Sold out" disabled />
        ) : room ? (
          <Row gap={Space.sm}>
            <QuantityStepper value={amount} onChange={setQty} max={room} />
            <Button title={`Add · ${formatUGX(p.price * amount)}`} icon={ShoppingCart} onPress={addToCart} haptic style={{ flex: 1 }} />
          </Row>
        ) : (
          // Everything available (or the per-order maximum) is already in the cart.
          <Button title="View cart" icon={ShoppingCart} kind="secondary" onPress={() => router.push('/shop/cart')} />
        )
      }>
      {p.photos.length ? (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -Space.lg }}>
          {p.photos.map((uri, i) => (
            <Image
              key={`${uri}-${i}`}
              source={{ uri }}
              style={{ width, height: Math.min(width, 320), backgroundColor: c.surfaceAlt }}
              contentFit="contain"
              accessibilityLabel={`Photo ${i + 1} of ${p.photos.length}`}
            />
          ))}
        </ScrollView>
      ) : (
        <View style={{ height: 180, borderRadius: 16, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
          <Package size={48} color={c.textSubtle} />
        </View>
      )}
      {p.photos.length > 1 ? <Text variant="caption">Swipe for {p.photos.length - 1} more photo{p.photos.length > 2 ? 's' : ''}.</Text> : null}

      <View style={{ gap: Space.xs }}>
        <Text variant="title">{p.name}</Text>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: Font.bold, fontSize: 22, color: c.text }}>{formatUGX(p.price)}</Text>
          {soldOut ? <StatusPill label="Sold out" tone="danger" /> : <StatusPill label={p.stock <= 5 ? `Only ${p.stock} left` : 'In stock'} tone={p.stock <= 5 ? 'warning' : 'success'} />}
        </Row>
        <GenuineBadge warrantyMonths={p.warrantyMonths} seller={p.seller} />
      </View>

      {inCart ? (
        <InlineNotice icon={ShoppingCart} tone="info">
          {inCart} in your cart.
        </InlineNotice>
      ) : null}

      <Card style={{ gap: Space.sm }}>
        {details.map(([k, v], i) => (
          <View key={k}>
            {i ? <Divider /> : null}
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 4 }} gap={Space.md}>
              <Text tone="textMuted">{k}</Text>
              <Text variant="bodyStrong" style={{ flex: 1, textAlign: 'right' }}>
                {v}
              </Text>
            </Row>
          </View>
        ))}
      </Card>

      {p.description ? <Text>{p.description}</Text> : null}
      <Text variant="caption">
        {p.seller ? 'MyCarRepair collects it from the seller and delivers it, or you pick it up from MyCarRepair.' : 'Delivered to you or picked up from MyCarRepair.'} Pay with cash or mobile
        money when you receive it.
      </Text>
    </Screen>
  );
}
