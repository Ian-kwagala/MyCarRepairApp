import { router } from 'expo-router';
import { Car } from 'lucide-react-native';
import { useEffect } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Button, Skeleton, Text } from '@/components';
import { useVehicles } from '@/hooks/queries';
import { Radius, Space, useColors } from '@/theme';

export function VehiclePicker({ value, onChange, then }: { value: number | null; onChange: (id: number) => void; then: '/book' | '/diagnostics' | '/sos' }) {
  const c = useColors();
  const vehicles = useVehicles();
  useEffect(() => {
    if (value == null && vehicles.data?.length) onChange(vehicles.data[0].id);
  }, [vehicles.data, value, onChange]);
  if (vehicles.isLoading) return <Skeleton height={52} />;
  if (!vehicles.data?.length) {
    return <Button title="Add a car first" kind="outline" onPress={() => router.push({ pathname: '/vehicle/add', params: { then } })} />;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Space.sm }}>
      {vehicles.data.map((v) => {
        const active = v.id === value;
        return (
          <Pressable
            key={v.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${v.make} ${v.model} ${v.plateNumber}`}
            onPress={() => onChange(v.id)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: Space.sm,
              paddingHorizontal: Space.md,
              minHeight: 52,
              borderRadius: Radius.button,
              borderWidth: 1.5,
              borderColor: active ? c.primary : c.border,
              backgroundColor: active ? c.primarySoft : c.surface,
            }}>
            <Car size={20} color={active ? c.primary : c.textMuted} />
            <View>
              <Text variant="bodyStrong">
                {v.make} {v.model}
              </Text>
              <Text variant="caption">{v.plateNumber}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
