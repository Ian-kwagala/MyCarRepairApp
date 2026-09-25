import type { ExpoConfig } from 'expo/config';

// app.config.ts runs in Node; the app's tsconfig has no Node types, so type the one call used here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { existsSync } = require('fs') as { existsSync: (path: string) => boolean };

/**
 * One codebase, two store apps (blueprint §2.2 notes the app "could split later"):
 *   APP_VARIANT=owner     → "MyCarRepair"   (ug.mycarrepair.app)      car owners only
 *   APP_VARIANT=mechanic  → "MCR Mechanic"  (ug.mycarrepair.mechanic) mechanics only
 *   unset                 → development build with both roles (role toggle on sign-in).
 */
type Variant = 'owner' | 'mechanic' | 'all';
const VARIANT: Variant =
  process.env.APP_VARIANT === 'owner' || process.env.APP_VARIANT === 'mechanic' ? process.env.APP_VARIANT : 'all';

const VARIANTS = {
  owner: {
    name: 'MyCarRepair',
    slug: 'mycarrepair',
    scheme: 'mycarrepair',
    id: 'ug.mycarrepair.app',
    assets: 'owner',
    color: '#F97316',
  },
  mechanic: {
    name: 'MCR Mechanic',
    slug: 'mycarrepair-mechanic',
    scheme: 'mycarrepair-mechanic',
    id: 'ug.mycarrepair.mechanic',
    assets: 'mechanic',
    color: '#0F172A',
  },
  all: {
    name: 'MyCarRepair (dev)',
    slug: 'mycarrepair',
    scheme: 'mycarrepair',
    id: 'ug.mycarrepair.dev',
    assets: 'owner',
    color: '#F97316',
  },
} as const;

const v = VARIANTS[VARIANT];

// Firebase (push notifications while the app is closed). google-services.json comes from the Firebase console and
// holds both Android apps (ug.mycarrepair.app and ug.mycarrepair.mechanic); without it, alerts only arrive while
// the app is open.
const GOOGLE_SERVICES = './google-services.json';
const fcm = existsSync(GOOGLE_SERVICES);
const img = (file: string) => `./assets/images/${v.assets}/${file}`;

// Blueprint Appendix A.4 — app.config.ts essentials.
const config: ExpoConfig = {
  name: v.name,
  slug: v.slug,
  scheme: v.scheme,
  version: '1.0.0',
  orientation: 'portrait',
  icon: img('icon.png'),
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: v.id,
    icon: img('icon.png'),
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        VARIANT === 'mechanic' ? 'Share your position with owners and receive SOS jobs near you.' : 'Send help to exactly where you are.',
      NSCameraUsageDescription: 'Photograph cars and parts as evidence.',
      NSFaceIDUsageDescription: 'Unlock the app quickly and securely.',
    },
  },
  android: {
    package: v.id,
    adaptiveIcon: {
      backgroundColor: v.color,
      foregroundImage: img('adaptive-foreground.png'),
      monochromeImage: img('adaptive-monochrome.png'),
    },
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'CAMERA',
      'POST_NOTIFICATIONS',
      'VIBRATE',
      'USE_BIOMETRIC',
      // Full-screen incoming-SOS alert is a mechanic feature (§11).
      ...(VARIANT === 'owner' ? [] : ['USE_FULL_SCREEN_INTENT']),
    ],
    config: process.env.MAPS_KEY ? { googleMaps: { apiKey: process.env.MAPS_KEY } } : undefined,
    ...(fcm ? { googleServicesFile: GOOGLE_SERVICES } : {}),
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: 'single',
    favicon: img('favicon.png'),
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: v.color,
        image: img('splash-icon.png'),
        imageWidth: 120,
      },
    ],
    'expo-secure-store',
    'expo-sharing',
    'expo-web-browser',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          VARIANT === 'mechanic'
            ? 'MCR Mechanic uses your location to send you SOS jobs nearby and show owners where you are.'
            : 'MyCarRepair uses your location to send help to exactly where you are.',
      },
    ],
    ['expo-image-picker', { cameraPermission: 'The camera is used to photograph cars and parts as evidence.' }],
    // Status-bar icon: the white silhouette from the adaptive icon (Android shows small icons as a mask).
    ['expo-notifications', { color: '#F97316', icon: img('adaptive-monochrome.png') }],
    ['expo-local-authentication', { faceIDPermission: 'Unlock the app quickly and securely.' }],
    // Smaller APKs for sideloading and low-data installs (§11.1, NFR10 ≤ 35 MB): compressed native libraries,
    // and R8 shrinking of unused Java/Kotlin code and resources. Obfuscation stays off (-dontobfuscate) so
    // class names that libraries look up by reflection are never renamed.
    [
      'expo-build-properties',
      {
        android: {
          useLegacyPackaging: true,
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          extraProguardRules: '-dontobfuscate',
        },
      },
    ],
    './plugins/with-english-resources',
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  // Leave EXPO_PUBLIC_API_URL unset to run on the on-device local data store (see README).
  extra: {
    ...(VARIANT === 'all' ? {} : { appRole: VARIANT }),
    // Native Google Maps only when a key is baked in; otherwise map cards fall back to links (map-card.tsx).
    mapsEnabled: !!process.env.MAPS_KEY,
    fcm,
    ...(process.env.EXPO_PUBLIC_API_URL ? { apiUrl: process.env.EXPO_PUBLIC_API_URL } : {}),
  },
};

export default config;
