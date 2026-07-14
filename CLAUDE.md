# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**get.ride** is a ride-sharing mobile app (branded "Teksi") built with React Native/Expo, targeting iOS, Android, and web. It includes a full rider-facing interface, a partner (driver) onboarding and dispatch interface, and an extensive in-app admin panel for fleet/user/settings management.

The repository has two main subdirectories:
- `expo/` — the React Native / Expo Router application (all app code lives here)
- `supabase/` — database schema, seed data, and setup scripts

## Commands

All commands run from the `expo/` directory. The project uses **Bun** as the package manager. The `start*` scripts wrap the **Rork** CLI (`bunx rork start …`), not the bare Expo CLI — see `rork.json` at the repo root for the app registration.

```bash
cd expo

# Install dependencies
bun install

# Start dev server (web preview via tunnel)
bun run start-web

# Start dev server (native, then press "i" for iOS or "a" for Android)
bun run start

# Start web with verbose Expo debug logging
bun run start-web-dev

# Lint
bun run lint

# Run tests (Jest via jest-expo)
bun run test

# Run a single test file
bun run test utils/__tests__/fare.test.ts
```

Tests live in `expo/utils/__tests__/*.test.ts` and cover the pure logic layer (fare calculation, commission resolution, wallet accounting, ride-request schema degradation, restore-target mapping, PIN lockout parsing, IP access evaluation, API-key rotation). Config is in `expo/jest.config.js`; `expo/jest.setup.js` mocks AsyncStorage (official in-memory mock), `react-native-maps`, and `expo-location`. `expo/test-utils/supabaseMock.ts` provides a chainable, queue-based mock of the Supabase client — tests `jest.mock("@/utils/supabase")` and swap in `createSupabaseMock().client`, queueing per-query results and asserting on the recorded chains. Only `*.test.ts` files are picked up as suites, so shared helpers can live alongside them. There are no component/screen tests yet — new domain logic in `utils/` should ship with a colocated test.

To clear the Metro cache when things break:
```bash
bunx expo start --clear
```

## Architecture

### Routing

The app uses **Expo Router** with a flat file-based route structure under `expo/app/`. There are no nested tab groups — all screens are declared as flat `Stack.Screen` entries in `expo/app/_layout.tsx`. Screens prefixed with `admin-` are the in-app admin panel; screens prefixed with `partner-` are the driver/partner interface.

Auth flow order: `onboarding` → `phone-auth` → `otp-verify` → `name-entry` → `role-selection` → `pin-setup` / `pin-verify` → `index` (home map).

Tablet devices are automatically redirected to `/partner-teksi` instead of `/index`.

### Context Provider Tree

Providers are layered in `_layout.tsx` in this order (outermost first):

```
QueryClientProvider → LocationProvider → AuthProvider → ThemeProvider →
AdminDataProvider → AdminAccessProvider → DisplaySettingsProvider →
BrandingProvider → SessionTrackingProvider → EmergencyContactsProvider →
VoiceProtectionProvider → PushNotificationProvider → IpAccessProvider
```

Each context is created with `@nkzw/create-context-hook`, which produces a `[Provider, useX]` pair. Import from the context file directly (e.g. `import { useAuth } from "@/contexts/AuthContext"`).

### Key Contexts

- **AuthContext** (`contexts/AuthContext.tsx`) — the most complex context. Manages two auth paths:
  1. **Supabase phone-OTP flow** (primary): `sendOtp` → `verifyOtp` → `registerUser` (sets PIN) → `signInWithPin` on subsequent logins.
  2. **Legacy local PIN flow** (offline/fallback): stores users in AsyncStorage only.
  
  On startup it pings `/auth/v1/health` (5s timeout); if unreachable it falls back to the cached local session. `authState.isSupabaseSession` tells you whether RLS-protected Supabase calls will work.

- **AdminDataContext** (`contexts/AdminDataContext.tsx`) — holds all admin-facing data (partners, users, vehicles, settings entries). Syncs to/from Supabase via `utils/adminSync.ts` and caches to AsyncStorage under key `@admin_data_v3`. Settings are stored as `entries: Record<category, SettingEntry[]>` where each `SettingEntry.values` is a free-form key/value bag.

- **ThemeContext** — dark/light/system theme. Consume via `useColors()` hook (`hooks/useColors.ts`) which returns the right color palette for the active scheme from `constants/colors.ts`.

- **PushNotificationContext** (`contexts/PushNotificationContext.tsx`) — registers the device's Expo push token (via `utils/pushNotifications.ts`) and persists it to the `push_tokens` table. Broadcasts are sent from the admin "Push Notification" screen, which invokes the `send-push` Supabase edge function (see Database below). Audiences: `all`, `partners`, or `users` (`drivers` is a legacy alias for `partners`).

- Other feature contexts: **BrandingContext** (app name/logo/colors from `app_branding`), **DisplaySettingsContext** (admin UI prefs), **SessionTrackingContext** (records user sessions to `user_sessions`, including public IP/ISP details resolved via the `ip-lookup` edge function), **EmergencyContactsContext** (rider SOS contacts), **VoiceProtectionContext** (in-ride audio recording/protection), **LocationContext** (foreground location + permissions), **IpAccessContext** (evaluates the device's public IP against the admin-managed whitelist/blacklist in `ip_access_rules` — whitelisted admins skip the PIN, blacklisted devices are blocked at login).

Most non-admin domain state is kept in lightweight `utils/*Store.ts` modules (e.g. `supportStore.ts`, `vehicleStore.ts`, `partnerOnboardingStore.ts`) rather than React contexts — these are plain async functions wrapping Supabase/AsyncStorage.

### Supabase Data Layer

- Singleton client in `utils/supabase.ts`. Hardcoded fallback URL/key in that file; override with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` env vars (place in `expo/env`).
- All data-access functions for the admin panel live in `utils/adminSync.ts` — thin wrappers around `supabase.from(...).select/upsert/delete`.
- `uuidv4()` is exported from `utils/supabase.ts` for generating client-side primary keys before inserts.
- Always call `isSupabaseConfigured` / `getSupabaseOrThrow()` before using the client in new code.

### Ride Dispatch

Real ride matching goes through the `ride_requests` table via `utils/rideRequestsStore.ts` (no context — plain async functions plus Supabase realtime subscriptions). A rider inserts an `open` request; online partners subscribe to open requests in realtime, accept one (claiming it), and progress it through `accepted` → `arrived` → `on_trip` → `completed` (or `cancelled`/`expired`; open requests expire after 7 minutes, `REQUEST_EXPIRY_MS`). The rider watches their own request row for status changes. A database trigger (migration `0051`, using `pg_net` + Supabase Vault secrets `project_url`/`service_role_key`) fires the `send-push` edge function to notify the partner audience whenever a new open request is inserted.

Additional dispatch behaviors, all riding on `ride_requests` columns:

- **Fare offers/bidding**: partners can counter-offer via `submitRideOffer`; riders can raise the fare on an open request via `raiseRideRequestFare`.
- **Cancellation**: before the trip starts the rider cancels directly (`cancelRideRequest`, storing `cancel_reason`). Once `on_trip`, tapping X only *requests* cancellation (`cancel_requested_at`/`cancel_requested_by`, migration `0053`) — the driver sees a popup and accepts (→ `cancelled`) or declines (timestamp cleared).
- **Live location**: during an active ride both sides publish their real GPS position onto the request row (`publishLiveLocation` → `partner_live_*` / `user_live_*` columns, migration `0055`) and each side moves the other's map marker from realtime row updates.
- **Restore after restart**: on cold launch the rider is returned to their in-progress screen via `fetchOngoingRequestForRider` + `utils/ongoingRequestRestore.ts` (`buildRestoreTarget` maps status → `/ride-tracking` or `/ride-confirm`); the partner side uses `fetchOngoingRequestForPartner` to return to `/ride-running`.
- **Commission**: when a partner completes a trip, `ride-running.tsx` calls `chargeRideCommission` (see Wallets below).

### Wallets & Commission

Each account has three wallets (`utils/walletStore.ts`, tables `wallets`/`wallet_transactions` from migration `0056`, rider-facing screen `app/wallet.tsx`):

- **GET.wallet** (`get_wallet`) — master wallet, used in both user and partner mode, topped up via payment methods. Must stay non-negative.
- **GET.credit** (`get_credit`) — partner-only wallet that pays for in-app services and ride commissions; recharged by transferring from GET.wallet. May go negative (commission owed).
- **GET.coin** (`get_coin`, migrations `0061`–`0064`) — reward coin denominated in GC, used in both modes; must stay non-negative. The GC↔RM rate (and optional market-speculated pricing/supply cap) is set from Admin → Settings → Get Coin (`utils/getCoinStore.ts`). Coins are earned as ride rewards (`wallet_award_ride_coins` RPC, idempotent per ride), redeemed against QR payments and fares, bought/sold against GET.wallet on `app/wallet-trade.tsx`, and sent P2P between accounts (`transferCoins` → `wallet_transfer_coins` RPC, migration `0064`, which resolves recipients by account id or phone server-side; transfers move coins 1:1 without minting). Balances are ledger-driven: clients/RPCs insert `wallet_transactions` rows and the `0060` trigger moves `wallets.balance`.

On trip completion the platform commission is deducted from GET.credit through the `wallet_charge_ride_commission` RPC (migration `0057`) — atomic and idempotent (the charge is stamped on the ride row via `commission_charged_at`, so it can never apply twice).

Commission *rates* are configurable from Admin → Settings → Commission Rates (`app/admin-settings-commission.tsx`, `utils/commissionStore.ts`, table `commission_rates` from migration `0058`): one master platform default plus overrides resolved in priority order user → suburb → city → state → country → master → hardcoded 15% (`DEFAULT_COMMISSION_RATE`).

Both stores degrade gracefully: if the wallet/commission tables aren't in the live database yet, they fall back to device-local AsyncStorage copies and report `source: "local"` so callers can surface a notice.

### Maps

- Native: `utils/maps.ts` re-exports from `react-native-maps` and adds helpers (`decodePolyline`, `getRoute`, `reverseGeocode`).
- Web: `utils/maps.web.ts` is the platform override for web builds.
- API key: `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` (set in `expo/env`). Key rotation logic lives in `utils/mappingClient.ts` (`runWithMappingRotation`).

### Platform / Responsive

`hooks/useResponsive.ts` exposes `isTablet` (shortest side ≥ 600px on native, ≥ 768px on web), `isLargeTablet`, `contentMaxWidth`, etc. Used for layout branching between phone and tablet UIs.

Files with a `.web.ts` / `.web.tsx` suffix are automatically used by Metro/Expo for web builds instead of the matching `.ts` / `.tsx` file.

## Database

The full, consolidated schema lives in `supabase/schema.sql` (idempotent — safe to re-run). Key tables: `profiles`, `partners`, `vehicles`, `partner_documents`, `settings_entries`, `app_settings`, `rides`, `ride_requests`, `wallets`/`wallet_transactions`, `commission_rates`, `support_tickets`/`support_messages`/`support_calls`, `push_tokens`, `push_notifications`, `ip_access_rules`, plus geo tables (`countries`/`states`/`cities`/`suburbs`/`airport_areas`).

`supabase/migrations/` holds the numbered incremental migration history (`0001_…` onward). `schema.sql` is the canonical full snapshot; the migrations are the historical deltas that produced it. When adding tables/columns, update `schema.sql` and add a new numbered migration.

`supabase/functions/` holds Deno edge functions. There are two: `send-push` fans a notification out to registered Expo push tokens using the service-role key and logs to `push_notifications`; `ip-lookup` resolves the caller's public IP and ISP/geolocation (the mobile client can only see its LAN IP). Deploy with `supabase functions deploy <name> --no-verify-jwt`.

RLS is enabled by default, but many tables intentionally carry permissive/public write policies so the anon client can write directly (e.g. `ride_requests`, `app_settings`, `settings_entries`). Owner-scoped tables (like `profiles`) require `auth.uid()` to match the row; admin/back-office writes otherwise use the `service_role` key.

To bootstrap a new Supabase project (`setup.sh` applies `schema.sql` + `seed.sql`, and deploys edge functions if the Supabase CLI is on PATH):
```bash
export SUPABASE_DB_URL="postgres://postgres:PASSWORD@db.REF.supabase.co:5432/postgres"
./supabase/setup.sh                # creates schema + seeds + edge functions
./supabase/setup.sh --reset        # wipe, rebuild, reseed
./supabase/setup.sh --schema-only  # skip seed data
./supabase/setup.sh --no-functions # skip edge-function deploy
```

The user's 6-digit sign-in PIN is stored as a bcrypt hash in `profiles.pin_hash` (migration `0052`) — never in plaintext. The legacy `pin` and `login_pin` columns still exist as *write-only* compatibility inputs: a `BEFORE INSERT OR UPDATE` trigger (`hash_profile_pin`) hashes anything written to them and nulls the plaintext. The client sets/changes the PIN via the `set_login_pin` RPC and clears it via `clear_login_pin` (both `auth.uid()`-scoped); see `registerUser` in `AuthContext.tsx`, which falls back to the legacy column write on pre-`0052` databases. PIN verification for login goes through the `verify_pin_for_login` RPC, which is rate limited: 5 consecutive wrong attempts lock verification for 15 minutes and the RPC raises `PIN_LOCKED:<seconds-remaining>` while locked (parsed client-side by `parsePinLockSeconds` in `utils/pinLock.ts`).

## Conventions

- **Path alias**: `@/` maps to `expo/` (configured in `tsconfig.json`). Always use `@/` for internal imports.
- **Icons**: Use `lucide-react-native` exclusively. Import named icons directly.
- **Settings categories**: New admin settings belong in `settings_entries` with a new `category` string. `AdminDataContext` groups entries by category automatically; add a corresponding screen under `app/admin-settings-<category>.tsx` and register it in `_layout.tsx`.
- **Partner vs Driver**: The codebase uses "partner" throughout. `DriverRecord` and `DriverStatus` are deprecated aliases for `PartnerRecord` and `PartnerStatus` in `AdminDataContext.tsx`.
- **Diagnostics**: `/auth-diagnostics` is a hidden screen (reachable from the connection error modal) for debugging Supabase connectivity and OTP delivery. It is intentionally not shown in normal navigation.
- **Admin access guard**: Screens under the admin panel check `useAdminAccess()` from `AdminAccessContext`. Sub-admin permissions are stored in settings entries.
- **Graceful schema degradation**: newer `utils/*Store.ts` modules (wallets, commission rates) fall back to AsyncStorage when their tables/columns are missing from the live database, and `rideRequestsStore` retries writes without columns the DB reports as missing. Follow this pattern when adding features that depend on new migrations — the app must keep working against older databases.
- **Mock/test features**: `app/admin-settings-mock.tsx` exposes toggles (mock users/partners on the map, rider trip simulation, partner drive simulation) persisted via `DisplaySettingsContext`. Gate any demo/simulation behavior behind these flags rather than hardcoding it.
