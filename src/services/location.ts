// GPS and device hand-offs: location permission, one-off and continuous position fixes, turning
// coordinates into a place name, and opening the maps app, phone dialer or system settings.
import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';

/** A GPS position; `accuracy` is the error radius in metres when known. */
export interface Fix {
  lat: number;
  lng: number;
  accuracy: number | null;
}

/** Thrown when location permission is denied; the message explains why the app needs it. */
export class LocationPermissionError extends Error {
  constructor() {
    super('Location permission is off. MyCarRepair uses your location to send help to exactly where you are.');
  }
}

/** Makes sure the app may use location while open, asking the user if allowed. Returns whether it's granted. */
export async function ensureForegroundPermission(): Promise<boolean> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return true;
  // On phones, once the user has said "don't ask again" only the Settings app can grant it.
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

/**
 * Calls `onFix` as the device moves (at most every `intervalMs`, and only after moving 25 m).
 * Returns a subscription; call `.remove()` on it to stop.
 */
export async function watchPosition(onFix: (fix: Fix) => void, intervalMs: number) {
  if (!(await ensureForegroundPermission())) throw new LocationPermissionError();
  return Location.watchPositionAsync(
    { accuracy: Location.Accuracy.Balanced, timeInterval: intervalMs, distanceInterval: 25 },
    (pos) => onFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null }),
  );
}

/** Short place name like "Kololo, Kampala" for a position, or null if unknown (always null on web). */
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

/** Opens this app's page in the phone's Settings, e.g. to turn a denied permission back on. */
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
  // If no maps app handles the native link, open Google Maps in the browser instead.
  Linking.openURL(url).catch(() =>
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`),
  );
}

/** Opens the phone dialer with the number filled in. Does nothing if there's no number. */
export function callPhone(phone: string | null | undefined) {
  if (!phone) return;
  void Linking.openURL(`tel:${phone.replace(/\s/g, '')}`);
}
