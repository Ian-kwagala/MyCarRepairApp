import type { ExpoConfig } from 'expo/config';

// Blueprint Appendix A.4 — app.config.ts essentials.
const config: ExpoConfig = {
  name: 'MyCarRepair',
  slug: 'mycarrepair',
  scheme: 'mycarrepair',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'ug.mycarrepair.app',
    icon: './assets/expo.icon',
    infoPlist: {
      NSLocationWhenInUseUsageDescription: 'Send help to exactly where you are.',
      NSCameraUsageDescription: 'Photograph your car and parts as evidence.',
      NSFaceIDUsageDescription: 'Unlock MyCarRepair quickly and securely.',
    },
  },
  android: {
    package: 'ug.mycarrepair.app',
    adaptiveIcon: {
      backgroundColor: '#0f172a',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'CAMERA',
      'POST_NOTIFICATIONS',
      'USE_FULL_SCREEN_INTENT',
      'VIBRATE',
      'USE_BIOMETRIC',
    ],
    config: process.env.MAPS_KEY ? { googleMaps: { apiKey: process.env.MAPS_KEY } } : undefined,
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: 'single',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#0f172a',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
    'expo-secure-store',
    'expo-sharing',
    'expo-web-browser',
    [
      'expo-location',
      { locationWhenInUsePermission: 'MyCarRepair uses your location to send help to exactly where you are.' },
    ],
    [
      'expo-image-picker',
      { cameraPermission: 'MyCarRepair uses the camera to photograph your car and parts as evidence.' },
    ],
    ['expo-notifications', { color: '#F97316' }],
    ['expo-local-authentication', { faceIDPermission: 'Unlock MyCarRepair quickly and securely.' }],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  // Leave EXPO_PUBLIC_API_URL unset to run on the on-device local data store (see README).
  extra: process.env.EXPO_PUBLIC_API_URL ? { apiUrl: process.env.EXPO_PUBLIC_API_URL } : {},
};

export default config;
