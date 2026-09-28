// Expo app configuration, evaluated at build time. Picks the app name, bundle ID, icons, permissions and
// native plugins for the variant being built (owner app, mechanic app, or the combined dev build).
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

// Per-variant store identity: display name, URL scheme, bundle/package ID, icon folder and brand colour.
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

// Online updates (EAS Update): each store app has its own Expo project under the ian_mufasa account. The IDs are
// public identifiers, not secrets. The dev build has none, so it can never publish over a store app by mistake.
const EAS_PROJECT_IDS = {
  owner: 'e4044d6f-6ddc-47ec-b84f-426abafad81f',
  mechanic: 'a9201386-4a09-4b1e-843a-6631310229c9',
} as const;
const easProjectId = VARIANT === 'all' ? undefined : EAS_PROJECT_IDS[VARIANT];

// The live API. Store apps default to it, and so do their online updates: an update carries this config, so it
// must never lose the server address. EXPO_PUBLIC_API_URL overrides it; set it to "" for local data mode.
const PRODUCTION_API_URL = 'https://mycarrepair-api.onrender.com/api/v1';
const envApiUrl = process.env.EXPO_PUBLIC_API_URL;
const apiUrl = envApiUrl !== undefined ? envApiUrl || undefined : VARIANT === 'all' ? undefined : PRODUCTION_API_URL;

/** Path to an image in the current variant's asset folder. */
const img = (file: string) => `./assets/images/${v.assets}/${file}`;

// Blueprint Appendix A.4 — app.config.ts essentials.
const config: ExpoConfig = {
  name: v.name,
  slug: v.slug,
  scheme: v.scheme,
  // Bump the version for every new APK with native changes: online updates only reach builds with the same
  // version (runtimeVersion policy below), so older APKs never receive code that needs newer native parts.
  version: '1.0.0',
  runtimeVersion: { policy: 'appVersion' },
  // Store apps check the "production" channel on launch, download in the background and apply on the next launch.
  ...(easProjectId
    ? { owner: 'ian_mufasa', updates: { url: `https://u.expo.dev/${easProjectId}`, requestHeaders: { 'expo-channel-name': 'production' } } }
    : {}),
  orientation: 'portrait',
  icon: img('icon.png'),
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: v.id,
    icon: img('icon.png'),
    // Permission prompts iOS shows the user; the location wording depends on who is using the app.
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
    // Google Maps key is optional; without it the app shows map links instead of native maps.
    config: process.env.MAPS_KEY ? { googleMaps: { apiKey: process.env.MAPS_KEY } } : undefined,
    ...(fcm ? { googleServicesFile: GOOGLE_SERVICES } : {}),
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: 'single',
    favicon: img('favicon.png'),
  },
  // Config plugins that set up native code for each Expo module at prebuild time.
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
  // typedRoutes: type-checked route strings for expo-router; reactCompiler: automatic memoisation.
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  // Without an API URL (dev build, or EXPO_PUBLIC_API_URL="") the app runs on the on-device local data store.
  extra: {
    ...(VARIANT === 'all' ? {} : { appRole: VARIANT }),
    // Native Google Maps only when a key is baked in; otherwise map cards fall back to links (map-card.tsx).
    mapsEnabled: !!process.env.MAPS_KEY,
    fcm,
    ...(apiUrl ? { apiUrl } : {}),
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
};

export default config;
