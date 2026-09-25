import Constants from 'expo-constants';
import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

import { Brand, Radius } from '@/theme';

import { MapFallback } from './map-fallback';

// Native map card (iOS/Android). Web uses map-card.web.tsx instead.

/** Google Maps on Android needs an API key (MAPS_KEY at build time); iOS uses Apple Maps without one. */
const mapsAvailable = Platform.OS !== 'android' || Constants.expoConfig?.extra?.mapsEnabled === true;

/** A pin on the map; `kind` sets its colour. */
export interface MapPoint {
  lat: number;
  lng: number;
  label: string;
  kind: 'me' | 'mechanic' | 'owner';
}

const colors: Record<MapPoint['kind'], string> = { me: Brand.blue, mechanic: Brand.orange, owner: Brand.red };

/** Live map card (SOS, mechanic tracking, route preview). */
export function MapCard({ points, height = 220 }: { points: MapPoint[]; height?: number }) {
  if (!mapsAvailable) return <MapFallback points={points} height={height} />;
  return <NativeMap points={points} height={height} />;
}

/** The real map. Zooms to fit all pins whenever they move noticeably. */
function NativeMap({ points, height }: { points: MapPoint[]; height: number }) {
  const ref = useRef<MapView>(null);
  const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  // Positions rounded to ~10 m, so tiny GPS jitter doesn't re-zoom the map.
  const key =valid.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|');

  useEffect(() => {
    if (!ref.current || valid.length < 2) return;
    ref.current.fitToCoordinates(
      valid.map((p) => ({ latitude: p.lat, longitude: p.lng })),
      { edgePadding: { top: 48, right: 48, bottom: 48, left: 48 }, animated: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!valid.length) return null;
  const first = valid[0];
  return (
    <View style={[styles.wrap, { height }]} accessibilityLabel={`Map showing ${valid.map((p) => p.label).join(' and ')}`}>
      <MapView
        ref={ref}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={{ latitude: first.lat, longitude: first.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
        showsUserLocation={false}
        toolbarEnabled={false}>
        {valid.map((p) => (
          <Marker key={`${p.kind}-${p.label}`} coordinate={{ latitude: p.lat, longitude: p.lng }} title={p.label} pinColor={colors[p.kind]} />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: Radius.card, overflow: 'hidden' },
});
