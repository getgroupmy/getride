# GET.ride — rebuild

The rebuilt Expo application. It lives alongside the legacy app in `../expo/`
rather than replacing it, so each phase ships against the same Supabase project
and the old app keeps running until a surface is actually replaced.

Plan and rationale: see the rebuild scoping document.

## Status

**Phase 01 — Foundations: complete.**

| | |
|---|---|
| Logic modules ported | 108 |
| Tests | 63 suites, 1,140 passing |
| Typecheck | clean, **including** test files |
| Lint | clean |

The pure logic layer moved across first and intact: fare and taxi-meter
arithmetic, both TEKSI tariffs, commission resolution, wallet and coin
accounting, the OBD-II/CANBus protocol layer and PID catalogue, ESC/POS receipt
encoding, launch routing, and rate-card resolution — each with the tests that
prove it still behaves.

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

Phase 02 — rider core: map, place search, fare estimate, ride request,
dispatch, live tracking. `app/index.tsx` is a foundations placeholder and is
replaced by the map.
