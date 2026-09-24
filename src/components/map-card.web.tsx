import { MapPin } from 'lucide-react-native';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Radius, Space, useColors } from '@/theme';

import { Text } from './text';

export interface MapPoint {
  lat: number;
  lng: number;
  label: string;
  kind: 'me' | 'mechanic' | 'owner';
}

/** Web fallback: react-native-maps has no web support; show points with a Google Maps link. */
export function MapCard({ points, height = 220 }: { points: MapPoint[]; height?: number }) {
  const c = useColors();
  const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!valid.length) return null;
  return (
    <View style={[styles.wrap, { minHeight: height * 0.6, backgroundColor: c.infoSoft }]}>
      {valid.map((p) => (
        <Pressable
          key={`${p.kind}-${p.label}`}
          accessibilityRole="link"
          onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`)}
          style={styles.row}>
          <MapPin size={20} color={p.kind === 'mechanic' ? c.primary : p.kind === 'owner' ? c.danger : c.info} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">{p.label}</Text>
            <Text variant="caption">
              {p.lat.toFixed(5)}, {p.lng.toFixed(5)} · open in Google Maps
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: Radius.card, padding: Space.lg, gap: Space.md, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
});
