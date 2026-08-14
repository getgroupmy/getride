# GET.ride — rebuild

The rebuilt Expo application. It lives alongside the legacy app in `../expo/`
rather than replacing it, so each phase ships against the same Supabase project
and the old app keeps running until a surface is actually replaced.

Plan and rationale: see the rebuild scoping document.

## Status

**Phase 01 — Foundations: complete.**
**Phase 02 — Rider core: complete.**
**Phase 03 — Partner core: complete.**

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

### Phase 03 — partner core

The other half of the loop: a driver signs up, sees requests, claims one, and
carries it through to a completed, commissioned trip.

| Screen | Does |
|---|---|
| `partner-onboarding` | Creates/links the partner row and captures identity |
| `partner-ehailing` | Live queue of open requests; claim one |
| `ride-running` | Head to pickup → arrived → on trip → complete, then commission |
| `welcome-back` | Launch buffer: resumes a ride in progress on either side |

Notes on the pieces that are easy to get wrong:

- **The launch buffer** gathers inputs and navigates; the priority between
  destinations is `resolveLaunchDestination`, which is pure and already tested.
  It marks the launch handled *on mount* rather than on exit, because sign-in
  replaces into it directly and `index` re-enters while the flag is unset —
  otherwise the app loops on a greeting. A watchdog resolves the launch anyway
  if the lookups hang, since they are network reads with no timeout of their
  own, and the decision is never cancelled once started.
- **The once-per-launch flag lives in `utils/launchSession.ts`**, not a ref in a
  screen. `index` sits inside the navigator, so anything resetting navigation
  state re-renders it — a ref would read that as a fresh cold start.
- **The queue ages entries out on a clock.** Since migration 0069 a partner no
  longer receives realtime UPDATEs for a request another driver claimed, so
  stale cards cannot rely on an event to remove them. Losing the accept race is
  safe rather than an error: the `status = 'open'` guard means a null result is
  "someone got there first".
- **Live position stops when the trip does.** A finished ride must not keep
  broadcasting where the driver is.
- **Commission is charged once, after completion.** The RPC is idempotent
  (stamped on the ride row via `commission_charged_at`), and a failed charge is
  logged rather than surfaced as a failed trip — the fare is collected either
  way and the ledger reconciles server-side.

### Deferred

Partner **document upload and verification** is not in `partner-onboarding`: it
is a separate surface with its own storage buckets and admin review queue, and a
partner created by that screen is explicitly not verified by it. Vehicle
assignment, the partner mode picker (TEKSI vs e-hailing), online/offline
toggling and driver-side fare offers are supported by the ported store layer but
have no UI yet.

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

Phase 04 — money: GET.wallet, GET.credit, GET.coin, top-up and payout. The
highest-risk phase, since it touches real balances — it runs against the
existing ledger rather than a new one.
