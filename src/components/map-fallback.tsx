import { MapPin } from 'lucide-react-native';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Radius, Space, useColors } from '@/theme';

import type { MapPoint } from './map-card';
import { Text } from './text';

// Fallback "map" used when a real map can't be shown.

/**
 * Map without the Google Maps SDK: lists the points with an "open in Google Maps" link each.
 * Used on web (react-native-maps has no web support) and on Android builds made without MAPS_KEY
 * (the Maps SDK aborts the app when a map is shown without an API key).
 */
export function MapFallback({ points, height = 220 }: { points: MapPoint[]; height?: number }) {
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
