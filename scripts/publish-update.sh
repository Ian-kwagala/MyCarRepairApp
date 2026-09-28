#!/usr/bin/env bash
# Publishes an online update (EAS Update) to the installed store apps, without new APKs.
#   scripts/publish-update.sh owner "Fix the booking date picker"
#   scripts/publish-update.sh mechanic "New earnings chart"
#   scripts/publish-update.sh both "Wording fixes"
# Phones download the update in the background the next time the app opens and run it from the launch after.
# Only JavaScript/asset changes can ship this way. Native changes (new native modules, permissions, icons, Firebase,
# app.config plugins) need a new APK with a higher `version` in app.config.ts, which also stops older APKs from
# receiving updates they can't run. Needs EXPO_TOKEN for the ian_mufasa Expo account.
set -euo pipefail

TARGET="${1:-}"
MESSAGE="${2:-}"
case "$TARGET" in
  owner) VARIANTS=(owner) ;;
  mechanic) VARIANTS=(mechanic) ;;
  both) VARIANTS=(owner mechanic) ;;
  *) echo "usage: $0 owner|mechanic|both \"what changed\"" >&2; exit 1 ;;
esac
[ -n "$MESSAGE" ] || { echo "Describe the update: $0 $TARGET \"what changed\"" >&2; exit 1; }
: "${EXPO_TOKEN:?Set EXPO_TOKEN (an access token for the ian_mufasa Expo account)}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

for VARIANT in "${VARIANTS[@]}"; do
  echo "Publishing to the $VARIANT app…"
  # The update carries the app config, so it gets the same variant, server address and Firebase flag as the APK.
  # An empty EXPO_PUBLIC_API_URL would switch the installed apps to local data mode, so refuse it here.
  if [ -n "${EXPO_PUBLIC_API_URL+set}" ] && [ -z "$EXPO_PUBLIC_API_URL" ]; then
    echo "EXPO_PUBLIC_API_URL is empty: that would disconnect the apps from the server." >&2; exit 1
  fi
  APP_VARIANT="$VARIANT" NODE_ENV=production \
    npx eas-cli@latest update --channel production --environment production --platform android --message "$MESSAGE" --clear-cache --non-interactive
done
