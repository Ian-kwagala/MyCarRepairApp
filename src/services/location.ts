import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number | null;
}

export class LocationPermissionError extends Error {
  constructor() {
    super('Location permission is off. MyCarRepair uses your location to send help to exactly where you are.');
  }
}

export async function ensureForegroundPermission(): Promise<boolean> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain && Platform.OS !== 'web') return false;
  const res = await Location.requestForegroundPermissionsAsync();
  return res.granted;
}

/** High-accuracy fix for SOS; falls back to the last known position if a fresh fix times out. */
export async function getCurrentFix(timeoutMs = 12_000): Promise<Fix> {
  if (!(await ensureForegroundPermission())) throw new LocationPermissionError();
  const fresh = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs));
  const pos = (await Promise.race([fresh, timeout])) ?? (await Location.getLastKnownPositionAsync());
  if (!pos) throw new Error('Could not get a GPS fix. Move to an open area and try again.');
  return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null };
}

export async function watchPosition(onFix: (fix: Fix) => void, intervalMs: number) {
  if (!(await ensureForegroundPermission())) throw new LocationPermissionError();
  return Location.watchPositionAsync(
    { accuracy: Location.Accuracy.Balanced, timeInterval: intervalMs, distanceInterval: 25 },
    (pos) => onFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null }),
  );
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return null;
    const [r] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (!r) return null;
    return [r.district || r.street || r.name, r.city || r.subregion].filter(Boolean).join(', ') || null;
  } catch {
    return null;
  }
}

export function openSettings() {
  void Linking.openSettings();
}

/** Hand-off to Google Maps turn-by-turn (§11). */
export function openNavigation(lat: number, lng: number) {
  const url =
    Platform.OS === 'android'
      ? `google.navigation:q=${lat},${lng}`
      : Platform.OS === 'ios'
        ? `maps://?daddr=${lat},${lng}`
        : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  Linking.openURL(url).catch(() =>
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`),
  );
}

export function callPhone(phone: string | null | undefined) {
  if (!phone) return;
  void Linking.openURL(`tel:${phone.replace(/\s/g, '')}`);
}
