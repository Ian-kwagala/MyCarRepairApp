#!/usr/bin/env bash
# Builds a sideloadable release APK for one app variant, without EAS.
#   EXPO_PUBLIC_API_URL=https://<api-host>/api/v1 scripts/build-apk.sh owner
#   scripts/build-apk.sh owner      → dist/MyCarRepair-owner.apk     (ug.mycarrepair.app)
#   scripts/build-apk.sh mechanic   → dist/MCR-Mechanic.apk          (ug.mycarrepair.mechanic)
# Needs JDK 17+, and ANDROID_HOME pointing at an SDK with platform 36, build-tools 36, NDK 27.1.
# The APK is signed with the debug key from the Expo template: fine for testing, not for the Play Store
# (use `eas build --profile production` for store builds).
set -euo pipefail

VARIANT="${1:-}"
case "$VARIANT" in
  owner) OUT="MyCarRepair-owner.apk" ;;
  mechanic) OUT="MCR-Mechanic.apk" ;;
  *) echo "usage: $0 owner|mechanic" >&2; exit 1 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export APP_VARIANT="$VARIANT" NODE_ENV=production CI=1
: "${ANDROID_HOME:?Set ANDROID_HOME to your Android SDK}"
if [ -z "${EXPO_PUBLIC_API_URL:-}" ]; then
  echo "warning: EXPO_PUBLIC_API_URL is not set: this APK will use local data mode and won't share data with the other app." >&2
fi

# Metro caches transformed modules (including inlined config); start clean so variants never mix.
rm -rf "${TMPDIR:-/tmp}"/metro-* "${TMPDIR:-/tmp}"/haste-map-* node_modules/.cache 2>/dev/null || true
# prebuild rewrites the android/ios npm scripts; keep the Expo Go ones in package.json.
cp package.json "${TMPDIR:-/tmp}/package.json.prebuild-backup"
npx expo prebuild --platform android --clean --no-install
cp "${TMPDIR:-/tmp}/package.json.prebuild-backup" package.json
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

# arm64-v8a covers practically every Android phone sold since ~2019; add armeabi-v7a for older 32-bit
# devices with ARCHS=arm64-v8a,armeabi-v7a (bigger APK).
(cd android && ./gradlew assembleRelease -PreactNativeArchitectures="${ARCHS:-arm64-v8a}" --console=plain)

mkdir -p dist
cp android/app/build/outputs/apk/release/app-release.apk "dist/$OUT"
echo "Built dist/$OUT"
