# MyCarRepair 🔧 — Mobile App

Trusted mechanics, anytime, anywhere. MyCarRepair connects car owners with verified mechanics in Kampala, Uganda.
Owners can send a GPS emergency SOS, book services, track repairs live, and approve every spare part (with photo and
price) before it goes on the bill. Mechanics get a live job board, digital job cards, parts quoting, earnings and reviews.

This repository is the **native Android & iOS app** described in
[`MyCarRepair_Mobile_App_Blueprint.pdf`](./MyCarRepair_Mobile_App_Blueprint.pdf) (v1.0) — React Native · Expo SDK 57 ·
TypeScript · Expo Router. One app, two role modes (owner / mechanic). The admin console stays on the web.

---

## Two apps: owner and mechanic

The same codebase builds two separate Android apps; `APP_VARIANT` selects one at build time:

| App | `APP_VARIANT` | Package | Icon |
| --- | --- | --- | --- |
| **MyCarRepair** (car owners) | `owner` | `ug.mycarrepair.app` | white car on orange |
| **MCR Mechanic** (mechanics) | `mechanic` | `ug.mycarrepair.mechanic` | orange wrench on navy |

Each app is locked to its role: there's no role toggle, and the welcome copy and icons are its own. Leaving
`APP_VARIANT` unset gives a development build with both roles (the role toggle on sign-in).

Build a sideloadable APK without EAS (needs JDK 17+ and an Android SDK with platform 36, build-tools 36 and
NDK 27.1 at `ANDROID_HOME`):

```bash
scripts/build-apk.sh owner       # → dist/MyCarRepair-owner.apk
scripts/build-apk.sh mechanic    # → dist/MCR-Mechanic.apk
```

Each APK installs on any Android phone running Android 7.0 or newer: it carries native code for both 64-bit
(`arm64-v8a`) and 32-bit (`armeabi-v7a`) phones. Emulator-only x86 builds are left out to keep the APK small
(`ARCHS=armeabi-v7a,arm64-v8a,x86,x86_64` adds them).

These APKs are signed with the Expo template's debug key, which is fine for testing but not for the Play
Store. For store builds use `npx eas-cli@latest build --profile production` with `APP_VARIANT` set.

> **The two apps share data through the backend.** Build both with the same `EXPO_PUBLIC_API_URL`
> (see **Backend** below). An APK built without it runs in local data mode, where each app only sees its own data.

## Quick start

```bash
npm install
npx expo start          # press a (Android), i (iOS) or w (web preview)
```

- **Expo Go** runs everything except remote push notifications (Android push needs a development build since SDK 53).
- **Development build** (recommended for testing on a phone): `npx eas-cli@latest build --profile development --platform android`.
- Checks: `npm run lint` · `npm run typecheck` · `npm test`.

## Backend (shared data for both apps)

`server/` is the API the blueprint describes (§6–§8): **Node.js + Express + PostgreSQL + Socket.io**. It
implements every `/api/v1` endpoint the apps call, on the web platform's tables (same columns, plus the
additive `device_tokens`, `job_extras`, `media`, `refresh_tokens` and `password_resets`).

- **Auth:** bcrypt passwords, 24 h access tokens with 30-day rotating refresh tokens, role and ownership
  guards on every route. Pending mechanics can only reach `/me` until an admin approves them.
- **Rules enforced in the database:** the atomic first-come accept (`UPDATE … WHERE mechanic_id IS NULL`),
  FR-03 nearest-5-within-10 km dispatch (widening to 20 km after 60 s), the finish lock (422), parts
  approval, one review per job, SOS cancel → `cancelled`, and the SOS rate limit.
- **Real time:** Socket.io with the JWT in the handshake. The server joins each user to their own
  `user_<id>` room, so nobody receives anyone else's events. Users who aren't connected get an Expo push
  instead.
- **Photos:** type-sniffed uploads, 5 MB max, served from `/media/<random key>`. **Receipts:** PDFs
  (PDFKit) behind signed 15-minute links.
- **`/admin`:** a password-protected page (`ADMIN_PASSWORD`) to approve or suspend mechanics, and to read
  password-reset codes to callers after verifying them. There's no SMS provider yet.

Run it locally:

```bash
docker compose up --build              # PostgreSQL + API on http://localhost:4000/api/v1
# or, with your own PostgreSQL:
cd server && npm install && DATABASE_URL=postgres://… npm start
```

**Deploy** (one-time, about 5 minutes): on render.com choose **New → Blueprint** and pick this repository.
`render.yaml` creates the API and the database. You'll get a URL like `https://mycarrepair-api.onrender.com`.
Any Node host works too: `server/Dockerfile` builds from the repo root.

**Point the apps at it:** set `EXPO_PUBLIC_API_URL` when you start or build them:

```bash
EXPO_PUBLIC_API_URL=https://mycarrepair-api.onrender.com/api/v1 scripts/build-apk.sh owner
EXPO_PUBLIC_API_URL=https://mycarrepair-api.onrender.com/api/v1 scripts/build-apk.sh mechanic
```

Without `EXPO_PUBLIC_API_URL`, an app falls back to **local data mode**: an empty store on the phone that
enforces the same rules, useful for trying the UI with no server. Release builds only accept `https://`
API URLs.

Tests: `cd server && npm test` runs the API integration tests against PostgreSQL (`TEST_DATABASE_URL`). CI
runs them on every push.

## What is built (blueprint §3 MVP scope)

| ID | Screen | File |
| --- | --- | --- |
| A1–A4 | Welcome, Sign in (role toggle), Sign up (owner / mechanic + garage), Forgot password | `src/app/(auth)/*` |
| O1 | Owner home — 1-tap SOS, services, live active-repair card, garage | `src/app/(owner)/(tabs)/index.tsx` |
| O2 · O3 · O4 | SOS issue picker (GPS lock) → broadcasting radar → mechanic found (live map, ETA, call) | `src/app/(owner)/sos/*` |
| X1 | Offline SOS queue, auto-send when signal returns, SMS / call fallback | `src/app/(owner)/sos/offline.tsx` |
| O5 · O6 | Garage (service-due reminder) · 3-step add/edit vehicle wizard, ≤ 5 compressed photos | `src/app/(owner)/(tabs)/garage.tsx`, `vehicle/*` |
| O7 · O8 | Book service (date strip, notes) · Diagnostics (symptoms + photo) | `src/app/(owner)/book.tsx`, `diagnostics.tsx` |
| O9 · O10 · O11 | Live tracker (5-stage timeline, checklist) · Parts approval sheet (new-total preview) · Receipt PDF + rating | `src/app/(owner)/job/*`, `quote/[id].tsx` |
| O12 · O13 | Activity (active / history by date, cached offline) · Notification centre | `(tabs)/activity.tsx`, `src/app/notifications.tsx` |
| M1 | Job board — Online toggle, stats, SOS / Bookings / Active / History, distance-sorted, Accept / Skip | `src/app/mechanic/(tabs)/index.tsx` |
| M2 | Incoming SOS — full screen, 30-s countdown, vibration, "Too late" on 409 | `src/app/mechanic/incoming/[id].tsx` |
| M3 · M4 · M5 | En route (map, call, Google Maps hand-off, "Reached car") · Digital job card (photo proof per task, finish lock) · Quote with camera | `src/app/mechanic/job/[id]/*` |
| M6 · M7 | Earnings (weekly / monthly bars, payouts) · Verification status for pending mechanics | `mechanic/(tabs)/earnings.tsx`, `src/app/verify.tsx` |
| — | Profile, edit profile, reviews, settings (biometric unlock, alerts, privacy, account deletion) | `src/app/*`, `src/features/profile-screen.tsx` |

**Business rules enforced** (local store + UI): UGX 50,000 service fee · first-come atomic claim (409) · parts are
billed only if approved, and the decision is final · "Finish job" is locked while tasks are open or quotes are pending
(422) · 1 review per job, quick-tags stored inside `reviews.feedback` · SOS cancel → `cancelled` (not `completed`) ·
diagnostic symptoms persisted in `jobs.service_type` · FR-03 dispatch to the nearest 5 online mechanics within 10 km,
widening to 20 km after 60 s · declining a booking cancels it (web parity) · pending mechanics are held on M7 · role
and ownership guards on every call · phone and exact location are revealed only to the counter-party of an accepted job.

**Native capabilities**: GPS (SOS fix, mechanic location every 15 s while online / on a job), camera and gallery with
compression (1600 px, JPEG 0.7), push-notification channels (`sos`, `jobs`, `general`) and deep links
(`mycarrepair://job/:id`, `…/quote/:id`, `…/mechanic/job/:id`), haptics, keep-awake during SOS, biometric app lock,
PDF receipts (open / share), offline cache (TanStack Query persisted), an offline banner, and dark mode.

## Project structure (blueprint §14.1)

```
src/
├── app/            Expo Router screens: (auth) · (owner) tabs + stacks · mechanic tabs + stacks · shared
├── api/            ApiClient contract, remote (HTTP + Socket.io) and local (on-device) implementations
├── models/         TypeScript models — same as the database (Appendix A)
├── components/     Button, Card, StatusPill, ChecklistRow, QuoteCard, PhotoPicker, MapCard, Stars, Toast…
├── features/       Cross-screen logic: real-time bridge, mechanic presence / incoming SOS, forms
├── services/       location, media, notifications, storage (SecureStore for tokens), receipts, offline SOS queue
├── store/          Zustand: session, preferences, toasts
├── hooks/          TanStack Query hooks, connectivity, notifications
├── theme/          Design tokens (§12): navy #0f172a, orange #F97316, red = SOS only, green = money
└── utils/          UGX formatting, stage mapping, geo, receipt HTML
```

## What I need from you (open questions)

1. **Deploy the backend** (see **Backend**): create the Render Blueprint, or give me access to another
   host. The APKs get the API URL at build time.
2. **Web platform repository link:** if the web platform's PostgreSQL database should be shared too, point
   `DATABASE_URL` at it. The schema matches, and the extra tables are additive. The `/api/v1` routes could
   also move into the web backend's Express app.
3. **Password resets:** codes are read out by support from `/admin` for now. An SMS provider (Africa's
   Talking, blueprint Phase 2) would send them automatically.
4. For release builds: a **Google Maps API key** (`MAPS_KEY`), an **EAS project** (for push notifications
   when the app is closed), the **support / emergency phone number** (placeholder `+256700000000` in
   `src/constants/config.ts`, or the `support_phone` row in `system_config`), and a **Play Store signing
   key**.
