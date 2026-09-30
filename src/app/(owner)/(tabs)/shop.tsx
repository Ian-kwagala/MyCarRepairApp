// Owner Shop tab (marketplace): genuine spare parts and accessories from MyCarRepair and checked sellers. Sections,
// search, a "fits my car" filter and the product grid; the cart and past orders open from the header.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Chip, EmptyState, ErrorState, Grid, IconButton, InlineNotice, Row, Screen, SkeletonList, TextField } from '@/components';
import { ReceiptText, ShieldCheck, Store } from '@/components/icons';
import { PRODUCT_CATEGORIES } from '@/constants/config';
import { CartButton, ProductCard } from '@/features/shop-ui';
import { useProducts, useVehicles } from '@/hooks/queries';
import type { ProductCategory } from '@/models';
import { useCart } from '@/store/cart';
import { useUser } from '@/store/session';
import { Space } from '@/theme';

type Section = ProductCategory | 'all';

/** The Shop tab. */
export default function Shop() {
  const user = useUser();
  const loadCart = useCart((s) => s.load);
  const vehicles = useVehicles();
  const [section, setSection] = useState<Section>('all');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [fitsCar, setFitsCar] = useState<number | null>(null);

  // The cart is saved per account; load it when the shop opens.
  useEffect(() => {
    if (user) void loadCart(user.id);
  }, [user, loadCart]);

  // Search as the owner types, but only once they pause (saves data on slow connections).
  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const products = useProducts({ category: section === 'all' ? undefined : section, q: term || undefined, vehicleId: fitsCar ?? undefined });
  const list = products.data ?? [];
  const filtered = section !== 'all' || !!term || fitsCar != null;

  return (
    <Screen
      title="Shop"
      eyebrow="Genuine parts & accessories"
      inTabs
      refreshing={products.isRefetching}
      onRefresh={() => products.refetch()}
      right={
        <Row gap={0}>
          <IconButton icon={ReceiptText} label="My orders" onPress={() => router.push('/shop/orders')} />
          <CartButton />
        </Row>
      }>
      <TextField label="Search the shop" value={search} onChangeText={setSearch} placeholder="Brake pads, tyres, part number…" returnKeyType="search" autoCorrect={false} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Space.sm, paddingVertical: 2 }}>
        <Chip label="All" selected={section === 'all'} onPress={() => setSection('all')} />
        {PRODUCT_CATEGORIES.map((c) => (
          <Chip key={c.key} label={c.label} selected={section === c.key} onPress={() => setSection(c.key)} />
        ))}
      </ScrollView>

      {vehicles.data?.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Space.sm, paddingVertical: 2 }}>
          <Chip label="Any car" selected={fitsCar == null} onPress={() => setFitsCar(null)} />
          {vehicles.data.map((v) => (
            <Chip key={v.id} label={`Fits ${v.model} · ${v.plateNumber}`} selected={fitsCar === v.id} onPress={() => setFitsCar(v.id)} />
          ))}
        </ScrollView>
      ) : null}

      {products.isLoading ? (
        <SkeletonList count={3} height={180} />
      ) : products.error ? (
        <ErrorState error={products.error} onRetry={() => products.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Store}
          title={filtered ? 'Nothing matches' : 'The shop is being stocked'}
          body={filtered ? 'Try another section, search, or “Any car”.' : 'Genuine parts and accessories will appear here soon.'}
        />
      ) : (
        <View style={{ marginHorizontal: -Space.xs }}>
          <Grid columns={2}>
            {list.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </Grid>
        </View>
      )}

      <InlineNotice icon={ShieldCheck} tone="success">
        Every item is genuine: sold by MyCarRepair or by sellers we check. We deliver, and you pay with cash or mobile money when it arrives.
      </InlineNotice>
    </Screen>
  );
}
