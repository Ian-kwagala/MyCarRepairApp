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

These APKs are signed with the Expo template's debug key, which is fine for testing but not for the Play
Store. For store builds use `npx eas-cli@latest build --profile production` with `APP_VARIANT` set.

> **Local data mode and two apps:** until a backend is connected, each app keeps its data on its own phone, so
> the owner app and the mechanic app can't see each other's jobs yet. Setting `EXPO_PUBLIC_API_URL` to the
> shared backend connects them. To try both roles against each other before then, use the development build
> (`npx expo start`), which has both roles in one app.

## Quick start

```bash
npm install
npx expo start          # press a (Android), i (iOS) or w (web preview)
```

- **Expo Go** runs everything except remote push notifications (Android push needs a development build since SDK 53).
- **Development build** (recommended for testing on a phone): `npx eas-cli@latest build --profile development --platform android`.
- Checks: `npm run lint` · `npm run typecheck` · `npm test`.

## Where does the data live? (data modes)

The data source has not been decided yet, so the app talks to one interface — `ApiClient` in
[`src/api/types.ts`](src/api/types.ts), one method per endpoint of the blueprint's §7 API contract — with two
implementations:

| Mode | When | What it does |
| --- | --- | --- |
| **Local** (default) | `EXPO_PUBLIC_API_URL` not set | An **empty** on-device store ([`src/api/local`](src/api/local)). No seed/mock data: you create real accounts, cars and jobs. It uses the web platform's exact table/column names (`users`, `vehicles`, `jobs`, `job_checklists`, `parts_quotes`, `reviews`, `system_config`) and enforces the same business rules as the server, so the whole app is usable end-to-end today. |
| **Remote** | `EXPO_PUBLIC_API_URL=https://api.mycarrepair.ug/api/v1` | HTTPS JSON client for `/api/v1` ([`src/api/remote/client.ts`](src/api/remote/client.ts)) — JWT bearer + refresh, multipart photo upload, `{ error: { code, message } }` envelope — plus Socket.io real-time with the JWT in the handshake. |

Switching modes changes no screen code. Testing both roles on one phone in local mode:
1. Sign up as a **mechanic** → on the "Application under review" screen tap **Approve now (local mode)** (stands in
   for the web admin portal) → go **Online**.
2. Sign out (a signed-out mechanic goes offline), sign up as an **owner**, add a car, send an SOS or book a service.
3. Sign in as the mechanic again and go Online → the incoming-SOS alert pops up → accept, arrive, tick tasks, quote a
   part → sign in as the owner to approve → mechanic finishes → owner gets the receipt and rates.

`Settings → Erase all local data` resets the device store.

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

1. **Web platform repository link** — to match the exact field names and payloads of the existing backend, and to
   see whether `/api/v1` already exists or still has to be built (blueprint Phase 0).
2. **Where the data will live** — the existing Node/Express + PostgreSQL backend, or something else (e.g. Supabase).
   Only `src/api` changes.
3. **Booking date and notes** — the `jobs` table has no `scheduled_date` / `notes` column (nor a diagnostic photo
   column). How does the web store them? The local store keeps them in an auxiliary table for now.
4. **Owner cancelling a booking** — §7 only defines `POST /sos/:id/cancel`. The app uses it for any pending request.
   Should the backend accept bookings there, or add `POST /jobs/:id/cancel`?
5. **Forgot password (A4)** — not in the §7 contract. The app expects `POST /auth/forgot-password` and
   `POST /auth/reset-password` (OTP).
6. For release builds: a **Google Maps API key** (`MAPS_KEY`), an **EAS project** (for push), the **support / emergency
   phone number** (placeholder `+256700000000` in `src/constants/config.ts`), and the **app icon and splash artwork**
   (the Expo template images are still in `assets/`).
