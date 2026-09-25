// Distance and travel-time helpers for dispatching mechanics and showing ETAs.

/** Haversine distance in km — same formula as the FR-03 nearest-mechanic SQL (§6.3). */
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/** Rough urban ETA for Kampala traffic (~20 km/h average, 3 min minimum). */
export function etaMinutes(km: number): number {
  return Math.max(3, Math.round((km / 20) * 60));
}

/** ETA as a 4-minute window, e.g. "9 – 13 minutes"; a default window when the distance is unknown. */
export function etaRange(km: number | null): string {
  if (km == null) return '8 – 12 minutes';
  const m = etaMinutes(km);
  return `${m} – ${m + 4} minutes`;
}

/** Distance for display: metres under 1 km ("450 m"), otherwise km to one decimal ("3.2 km"). */
export function formatKm(km: number | null | undefined): string {
  if (km == null) return '—';
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}
