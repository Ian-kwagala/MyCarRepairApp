// Web version of the map card (the bundler picks this file over map-card.tsx on web).
import { MapFallback } from './map-fallback';

export type { MapPoint } from './map-card';

/** react-native-maps has no web support. */
export const MapCard = MapFallback;
