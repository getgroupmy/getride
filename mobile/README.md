# GET.ride — rebuild

The rebuilt Expo application. It lives alongside the legacy app in `../expo/`
rather than replacing it, so each phase ships against the same Supabase project
and the old app keeps running until a surface is actually replaced.

Plan and rationale: see the rebuild scoping document.

## Status

**Phase 01 — Foundations: complete.**
**Phase 02 — Rider core: complete.**

| | |
|---|---|
| Logic modules ported | 108 |
| Tests | 64 suites, 1,156 passing |
| Typecheck | clean, **including** test files |
| Lint | clean |

### Phase 02 — rider core

The loop a passenger actually uses: sign in, see where you are, pick a
destination, get a price, book it, watch the driver come.

| Screen | Does |
|---|---|
| `phone-auth` → `otp-verify` → `pin-setup` | Supabase phone OTP, then a 6-digit PIN |
| `index` | Map home; current position as pickup |
| `search` | Debounced place search |
| `ride-confirm` | Route, distance, time and fare; creates the request |
| `ride-tracking` | Live status, driver position, trip PIN, cancel |

Supporting work:

- **`utils/placeSearch.ts`** — the missing half of geocoding. The legacy app had
  `reverseGeocode` (a fix → an address) but no query → place lookup. Nominatim
  rather than Google Places, matching the OSRM-first choice in `calculateRoute`,
  so search still works with no Maps key. Parsing is pure and has 16 tests.
- **`contexts/AuthContext.tsx`** — Supabase session only. The legacy context
  carried a second "local PIN" path that produced a session with no
  `auth.uid()`; since migration 0069 every ride, wallet and profile write is
  RLS-scoped, so that path could not write anything and was the direct cause of
  the "sign in required" failures. Deliberately not carried over.
- **`contexts/LocationContext.tsx`** — one fix, one address, one permission
  answer. The address is filled in after the fix rather than awaited with it, and
  a late geocode is discarded if the rider has already moved.
- **`components/RideMap.tsx`** (+ `.web.tsx`) — screens describe what is on the
  map and never touch `react-native-maps` directly. `utils/maps.web.ts` exports
  nulls, so web gets a listing stand-in rather than an empty box.

The fare comes from `calculateFare` — the same tested TEKSI arithmetic the meter
uses — so a quoted fare and a metered one cannot drift apart.

### Deferred

Fare bidding (OfferMe), fare raising, driver-approved mid-trip cancellation,
scheduled rides, saved places and payment-method selection are all supported by
the ported store layer but have no rider UI yet. Ride restore-on-relaunch
(`buildRestoreTarget`) is ported and tested but not yet wired to a launch
buffer — that arrives with the partner phase, which shares it.

### What changed on the way across

- **Domain types left the React contexts.** `utils/adminSync.ts`,
  `displaySettingsStore.ts` and `partnerModeOptions.ts` previously imported
  their own row shapes from `contexts/` and `components/`. Those are plain
  domain types with no UI involvement, so they now live in `types/admin.ts` and
  `types/displaySettings.ts` and the data layer no longer depends on the UI.
- **Tests are typechecked.** The legacy `tsconfig.json` excluded
  `**/__tests__/**`, which hid four latent type errors in fixtures (a `MeterTrip`
  missing `cardSurcharge`, a `MeterLeaveConfig` missing the catalogue-app
  fields, and a nullable `normalizeMeterProfile` result). They are fixed and the
  exclusion is not carried over.

### Deferred, not dropped

`utils/airportAreas.ts` and `utils/regionBidding.ts` call `useAdminData()` — a
genuine runtime dependency on the admin context rather than a type import. They
arrive with the back-office phase.

## Commands

```bash
bun install
bun run start        # dev server; press "i" for iOS, "a" for Android
bun run start-web
bun run test
bun run lint
bunx tsc --noEmit
```

## Environment

Set in `mobile/env` (or the shell):

- `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`

The Supabase schema is deliberately unchanged — the rebuilt client is written
against the existing project, migrations and RLS policies in `../supabase/`.

## Next

Phase 03 — partner core: onboarding and documents, the e-hailing queue, offers,
and the running-ride screen. That closes the loop and makes the app usable end
to end.
