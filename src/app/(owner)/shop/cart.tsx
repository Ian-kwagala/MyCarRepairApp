// Owner Shop: the cart and checkout. Lines with quantities, delivery or pickup, contact phone, payment on arrival
// (cash or mobile money), and the totals. The server re-prices the order and takes the stock when it's placed.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { api } from '@/api';
import { ApiError, errorMessage } from '@/api/errors';
import { Button, Card, Divider, EmptyState, haptic, IconButton, InlineNotice, Row, Screen, Section, Segmented, Text, TextField } from '@/components';
import { Banknote, MapPin, ShoppingCart, Smartphone, Trash2 } from '@/components/icons';
import { MAX_ORDER_QUANTITY } from '@/constants/config';
import { ItemThumb, QuantityStepper } from '@/features/shop-ui';
import { useConfig, useProducts } from '@/hooks/queries';
import type { Fulfilment, PaymentMethod } from '@/models';
import { queryClient } from '@/services/query-client';
import { Keys, kv } from '@/services/storage';
import { useCart } from '@/store/cart';
import { useUser } from '@/store/session';
import { toast } from '@/store/toast';
import { Space, useColors } from '@/theme';
import { formatUGX } from '@/utils/format';
import { orderTotals } from '@/utils/shop';

/** Cart and checkout. */
export default function Cart() {
  const c = useColors();
  const user = useUser();
  const config = useConfig();
  const { userId: cartOwner, lines, load, setQuantity, refresh, clear } = useCart();
  // All products in the shop (fresh prices and stock); the server lists up to 200.
  const catalogue = useProducts({});
  const [fulfilment, setFulfilment] = useState<Fulfilment>('delivery');
  const [payment, setPayment] = useState<PaymentMethod>('cash');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [note, setNote] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the saved cart and the last delivery address (remembered per account so repeat orders are quick).
  useEffect(() => {
    if (!user) return;
    void load(user.id);
    void kv.get<string>(Keys.shopAddress(user.id), '').then((a) => {
      if (a) setAddress((cur) => cur || a);
    });
  }, [user, load]);

  // Bring cart prices and stock up to date whenever fresh product data arrives (or the saved cart finishes loading).
  useEffect(() => {
    if (catalogue.data && cartOwner != null) refresh(catalogue.data);
  }, [catalogue.data, cartOwner, refresh]);

  // A product missing from the full list has been taken out of the shop (only knowable when the list isn't capped).
  const unavailable = (productId: number) => !!catalogue.data && catalogue.data.length < 200 && !catalogue.data.some((p) => p.id === productId);
  const problem = lines.some((l) => l.stock <= 0 || l.quantity > l.stock || unavailable(l.productId));
  const totals = orderTotals(
    lines.map((l) => ({ unitPrice: l.price, quantity: l.quantity })),
    fulfilment,
    config.deliveryFee,
  );

  const place = async () => {
    setError(null);
    if (!user) return;
    if (fulfilment === 'delivery' && address.trim().length < 5) return setError('Enter the delivery address (area, street, landmark).');
    if (phone.replace(/\D/g, '').length < 9) return setError('Enter a phone number we can call.');
    setPlacing(true);
    try {
      const order = await api.placeOrder({
        items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        fulfilment,
        paymentMethod: payment,
        deliveryAddress: fulfilment === 'delivery' ? address.trim() : undefined,
        contactPhone: phone.trim(),
        note: note.trim() || undefined,
      });
      if (fulfilment === 'delivery') void kv.set(Keys.shopAddress(user.id), address.trim());
      clear();
      haptic('success');
      void queryClient.invalidateQueries({ queryKey: ['shop'] });
      toast({ title: 'Order placed', body: 'We will call you to confirm it.', tone: 'success' });
      router.replace(`/shop/orders/${order.id}`);
    } catch (e) {
      setError(errorMessage(e));
      // Someone else bought the stock, or an item left the shop: reload so the cart shows what changed.
      if (e instanceof ApiError && (e.code === 'OUT_OF_STOCK' || e.code === 'PRODUCT_UNAVAILABLE')) void catalogue.refetch();
    } finally {
      setPlacing(false);
    }
  };

  if (!lines.length) {
    return (
      <Screen back title="Cart">
        <EmptyState
          icon={ShoppingCart}
          title="Your cart is empty"
          body="Genuine spare parts and accessories, delivered or ready for pickup."
          action={<Button title="Browse the shop" onPress={() => (router.canGoBack() ? router.back() : router.replace('/shop'))} />}
        />
      </Screen>
    );
  }

  return (
    <Screen
      back
      title="Cart"
      eyebrow="Checkout"
      footer={<Button title={`Place order · ${formatUGX(totals.total)}`} onPress={place} loading={placing} disabled={problem} haptic />}>
      <Card style={{ gap: Space.sm }}>
        {lines.map((l, i) => {
          const gone = l.stock <= 0 || unavailable(l.productId);
          return (
            <View key={l.productId} style={{ gap: Space.sm }}>
              {i ? <Divider /> : null}
              <Row gap={Space.md} style={{ alignItems: 'flex-start' }}>
                <ItemThumb uri={l.photo} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong" numberOfLines={2}>
                    {l.name}
                  </Text>
                  <Text variant="caption">{formatUGX(l.price)} each</Text>
                  {gone ? (
                    <Text variant="caption" tone="danger">
                      {unavailable(l.productId) ? 'No longer sold — remove it to continue.' : 'Sold out — remove it to continue.'}
                    </Text>
                  ) : l.quantity > l.stock ? (
                    <Text variant="caption" tone="danger">
                      Only {l.stock} left — lower the quantity.
                    </Text>
                  ) : null}
                </View>
                <IconButton icon={Trash2} label={`Remove ${l.name}`} onPress={() => setQuantity(l.productId, 0)} color={c.textMuted} />
              </Row>
              {!gone ? (
                <Row style={{ justifyContent: 'space-between' }}>
                  <QuantityStepper value={l.quantity} onChange={(v) => setQuantity(l.productId, v)} max={Math.max(l.quantity, Math.min(l.stock, MAX_ORDER_QUANTITY))} />
                  <Text variant="bodyStrong">{formatUGX(l.price * l.quantity)}</Text>
                </Row>
              ) : null}
            </View>
          );
        })}
      </Card>

      <Section title="How do you want it?">
        <Segmented options={['delivery', 'pickup'] as const} value={fulfilment} onChange={setFulfilment} labels={{ delivery: 'Deliver to me', pickup: 'I’ll pick it up' }} />
        {fulfilment === 'delivery' ? (
          <TextField
            label="Delivery address"
            value={address}
            onChangeText={setAddress}
            placeholder="Area, street, landmark (e.g. Ntinda, opposite Capital Shoppers)"
            multiline
            maxLength={300}
            hint={`Delivery fee ${formatUGX(config.deliveryFee)}.`}
          />
        ) : (
          <InlineNotice icon={MapPin} tone="info">
            Pick up from {config.pickupLocation}. We’ll tell you when it’s ready. No delivery fee.
          </InlineNotice>
        )}
        <TextField label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="07XX XXX XXX" maxLength={20} hint="We call this number to confirm the order." />
      </Section>

      <Section title="Pay when it arrives">
        <Segmented options={['cash', 'mobile_money'] as const} value={payment} onChange={setPayment} labels={{ cash: 'Cash', mobile_money: 'Mobile money' }} />
        <Row gap={Space.sm}>
          {payment === 'cash' ? <Banknote size={18} color={c.textMuted} /> : <Smartphone size={18} color={c.textMuted} />}
          <Text variant="caption" style={{ flex: 1 }}>
            {payment === 'cash'
              ? `Pay in cash ${fulfilment === 'delivery' ? 'to the rider on delivery' : 'at pickup'}. Nothing is charged now.`
              : `Pay by MTN or Airtel mobile money ${fulfilment === 'delivery' ? 'on delivery' : 'at pickup'}. Nothing is charged now.`}
          </Text>
        </Row>
        <TextField label="Note (optional)" value={note} onChangeText={setNote} placeholder="Best time to call, gate colour…" maxLength={300} />
      </Section>

      <Card style={{ gap: Space.xs, marginTop: Space.lg }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text tone="textMuted">Items</Text>
          <Text>{formatUGX(totals.subtotal)}</Text>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text tone="textMuted">Delivery</Text>
          <Text>{totals.deliveryFee ? formatUGX(totals.deliveryFee) : 'Free'}</Text>
        </Row>
        <Divider />
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="bodyStrong">Total</Text>
          <Text variant="heading">{formatUGX(totals.total)}</Text>
        </Row>
      </Card>

      {problem ? <InlineNotice tone="warning">Some items changed since you added them. Fix the items marked in red to continue.</InlineNotice> : null}
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
    </Screen>
  );
}
