import { MapFallback } from './map-fallback';

export type { MapPoint } from './map-card';

/** react-native-maps has no web support. */
export const MapCard = MapFallback;
