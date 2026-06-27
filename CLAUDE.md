# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**get.ride** is a ride-sharing mobile app (branded "Teksi") built with React Native/Expo, targeting iOS, Android, and web. It includes a full rider-facing interface, a partner (driver) onboarding and dispatch interface, and an extensive in-app admin panel for fleet/user/settings management.

The repository has two main subdirectories:
- `expo/` — the React Native / Expo Router application (all app code lives here)
- `supabase/` — database schema, seed data, and setup scripts

## Commands

All commands run from the `expo/` directory. The project uses **Bun** as the package manager. The `start*` scripts wrap the **Rork** CLI (`bunx rork start …`), not the bare Expo CLI — see `rork.json` at the repo root for the app registration (`project id: 18j1hsrd9328tctucaf2f`).

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
```

There is no test suite — the project has no test runner configured.

To clear the Metro cache when things break:
```bash
bunx expo start --clear
```

## Architecture

### Routing

The app uses **Expo Router** with a flat file-based route structure under `expo/app/`. There are no nested tab groups — all screens are declared as flat `Stack.Screen` entries in `expo/app/_layout.tsx`. Screens prefixed with `admin-` are the in-app admin panel; screens prefixed with `partner-` are the driver/partner interface.

Auth flow order: `onboarding` → `phone-auth` → `otp-verify` → `name-entry` → `role-selection` → `pin-setup` / `pin-verify` → `index` (home map).

Tablet devices are automatically redirected to `/partner-teksi` instead of `/index`.

The new React Native architecture is enabled (`newArchEnabled: true` in `app.json`). The deep-link scheme is `rork-app`.

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

- **PushNotificationContext** (`contexts/PushNotificationContext.tsx`) — registers the device's Expo push token (via `utils/pushNotifications.ts`) and persists it to the `push_tokens` table. Broadcasts are sent from the admin "Push Notification" screen, which invokes the `send-push` Supabase edge function. Audiences: `all`, `partners`, or `users` (`drivers` is a legacy alias for `partners`).

- **IpAccessContext** (`contexts/IpAccessContext.tsx`) — enforces IP-based access restrictions. Wraps the entire app tree as the innermost provider.

- Other feature contexts: **BrandingContext** (app name/logo/colors from `app_branding`), **DisplaySettingsContext** (admin UI prefs), **SessionTrackingContext** (records user sessions to `user_sessions`), **EmergencyContactsContext** (rider SOS contacts), **VoiceProtectionContext** (in-ride audio recording/protection), **LocationContext** (foreground location + permissions).

Most non-admin domain state is kept in lightweight `utils/*Store.ts` modules rather than React contexts — these are plain async functions wrapping Supabase/AsyncStorage. Key stores: `supportStore.ts`, `vehicleStore.ts`, `partnerOnboardingStore.ts`, `vehicleOnboardingStore.ts`, `vehicleDocumentsStore.ts`, `vehicleAssignmentStore.ts`, `rideRequestsStore.ts`, `brandingStore.ts`, `displaySettingsStore.ts`, `apiKeysStore.ts`, `fareProviderStore.ts`, `regionBidding.ts`, `ipAccessStore.ts`, `serviceAssignmentsStore.ts`.

### Supabase Data Layer

- Singleton client in `utils/supabase.ts`. Hardcoded fallback URL/key in that file; override with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` env vars (place in `expo/env`).
- All data-access functions for the admin panel live in `utils/adminSync.ts` — thin wrappers around `supabase.from(...).select/upsert/delete`.
- `uuidv4()` is exported from `utils/supabase.ts` for generating client-side primary keys before inserts.
- Always call `isSupabaseConfigured` / `getSupabaseOrThrow()` before using the client in new code.

### Maps

- Native: `utils/maps.ts` re-exports from `react-native-maps` and adds helpers (`decodePolyline`, `getRoute`, `reverseGeocode`).
- Web: `utils/maps.web.ts` is the platform override for web builds.
- API key: `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` (set in `expo/env`). Key rotation logic lives in `utils/mappingClient.ts` (`runWithMappingRotation`).
- Route generation via Gemini: `utils/geminiRoute.ts`.

### AI / Fare Features

- `utils/fareAiStats.ts` — Fare AI statistics and analysis.
- `utils/fareProviderStore.ts` — Manages fare provider configuration.
- `utils/documentAiVerify.ts` — AI-powered document verification for partner onboarding.
- `utils/geminiRoute.ts` — Route generation using Gemini AI.

### Platform / Responsive

`hooks/useResponsive.ts` exposes `isTablet` (shortest side ≥ 600px on native, ≥ 768px on web), `isLargeTablet`, `contentMaxWidth`, etc. Used for layout branching between phone and tablet UIs.

Files with a `.web.ts` / `.web.tsx` suffix are automatically used by Metro/Expo for web builds instead of the matching `.ts` / `.tsx` file.

`hooks/useReadOnlyGuard.ts` — guards admin screens from writes when the admin is in read-only mode.

## Database

The full, consolidated schema lives in `supabase/schema.sql` (idempotent — safe to re-run). Key tables: `profiles`, `partners`, `vehicles`, `vehicle_make_models`, `partner_documents`, `settings_entries`, `app_settings`, `rides`, `support_tickets`/`support_messages`/`support_calls`, `push_tokens`, `push_notifications`, plus geo tables (`countries`/`states`/`cities`/`suburbs`/`airport_areas`).

Key enums: `partner_status`, `permit_status`, `user_status`, `gender_type`, `profile_status`, `id_verification_status`.

`supabase/migrations/` holds the numbered incremental migration history (`0001_…` onward). `schema.sql` is the canonical full snapshot; the migrations are the historical deltas that produced it. When adding tables/columns, update `schema.sql` and add a new numbered migration.

`supabase/functions/` holds Deno edge functions. The only one today is `send-push`, which fans a notification out to registered Expo push tokens using the service-role key and logs to `push_notifications`. Deploy with `supabase functions deploy send-push --no-verify-jwt`.

RLS is enabled by default. User-facing writes require `auth.uid()` to match the row owner. Admin/back-office writes require the `service_role` key.

To bootstrap a new Supabase project (`setup.sh` applies `schema.sql` + `seed.sql`, and deploys edge functions if the Supabase CLI is on PATH):
```bash
export SUPABASE_DB_URL="postgres://postgres:PASSWORD@db.REF.supabase.co:5432/postgres"
./supabase/setup.sh                # creates schema + seeds + edge functions
./supabase/setup.sh --reset        # wipe, rebuild, reseed
./supabase/setup.sh --schema-only  # skip seed data
./supabase/setup.sh --no-functions # skip edge-function deploy
```

The `pin` and `login_pin` columns on `profiles` both store the user's 6-digit sign-in PIN. `login_pin` is the canonical column; `pin` is the legacy alias. Both must be kept in sync — see `registerUser` in `AuthContext.tsx` for the resilience logic that handles schema-cache lag. PIN verification for login goes through the `verify_pin_for_login` RPC (migration `0045`).

## Screen Inventory

### Auth & Onboarding
`onboarding`, `phone-auth`, `otp-verify`, `name-entry`, `role-selection`, `pin-setup`, `pin-verify`, `profile-photo`, `change-pin`, `change-number`

### Rider
`index` (home map), `search`, `ride-confirm`, `ride-tracking`, `ride-running`, `ride-detail`, `offer-fare`, `map-picker`, `profile`, `edit-profile`, `settings`, `language`, `dark-mode`, `navigation`, `distances`, `rules-terms`, `safety`, `user-guide`, `emergency-contacts`, `emergency-contact-edit`, `support`, `support-chat`, `support-call`

### Partner / Driver
`partner-onboarding`, `partner-documents`, `vehicle-onboarding`, `partner-teksi`, `partner-ehailing`

### Admin
Entry: `admin-login`, `admin-dashboard`

**Partners**: `admin-partners`, `admin-partner-add`, `admin-partner-edit`, `admin-partners-all`, `admin-partners-approved`, `admin-partners-unapproved`, `admin-partners-blocked`, `admin-partners-rejected`, `admin-partners-unapproved-docs`, `admin-partners-permit-pending`, `admin-partners-permit-non-verified`, `admin-partners-permit-verified`

**Vehicles**: `admin-vehicles`, `admin-vehicle-add`, `admin-vehicle-edit`, `admin-vehicles-all`, `admin-vehicles-approved`, `admin-vehicles-unapproved`, `admin-vehicles-blocked`, `admin-vehicles-rejected`, `admin-vehicles-unapproved-docs`, `admin-vehicles-permit-pending`, `admin-vehicles-permit-non-verified`, `admin-vehicles-permit-verified`

**Users**: `admin-users`, `admin-user-add`, `admin-user-edit`, `admin-users-all`, `admin-users-approved`, `admin-users-unapproved`, `admin-users-blocked`, `admin-users-rejected`, `admin-users-deleted`, `admin-users-unapproved-docs`

**Documents**: `admin-documents`, `admin-documents-partners`, `admin-documents-users`, `admin-documents-vehicles`

**Support**: `admin-support`, `admin-support-pool`, `admin-support-chat`

**Other**: `admin-session-history`, `admin-orders`

**Settings** (`admin-settings-<category>`): `service`, `display`, `vehicle-make-model`, `partner-type`, `required-documents`, `document-type`, `vehicle-services`, `assign-service`, `assign-service-page`, `site`, `referral`, `referral-tree`, `sub-admin`, `ip-access`, `geo-fencing`, `multi-gate-places`, `multi-gate-place-gates`, `airport-areas`, `country-states-cities`, `api-keys`, `api-keys-services`, `api-keys-keys`, `api-elife`, `payment-type`, `payment-gateway`, `driver-incentive`, `leaderboard`, `rides`, `fare-ai`, `fare-ai-logs`, `promocode`, `insurance-providers`, `insurance-types`, `insurance-durations`, `insurance-premium`, `free-ride`, `fixed-price`, `subscription-plan`, `advertisement-banners`, `push-notification`, `social-links`, `world-currency`, `app-version`, `search-radius`, `page-list`, `email-templates`, `supabase`, `splash`, `app-icon`, `ev-vehicle-details`, `ev-vehicle-inventory`, `ev-delivery-advisors`, `ev-finance-options`, `ev-order-fee`

### Special
`teksi-ev` (EV vehicle sales flow), `auth-diagnostics` (hidden connectivity debugger, reachable only from the connection error modal)

## Conventions

- **Path alias**: `@/` maps to `expo/` (configured in `tsconfig.json`). Always use `@/` for internal imports.
- **Icons**: Use `lucide-react-native` exclusively. Import named icons directly.
- **Settings categories**: New admin settings belong in `settings_entries` with a new `category` string. `AdminDataContext` groups entries by category automatically; add a corresponding screen under `app/admin-settings-<category>.tsx` and register it in `_layout.tsx`.
- **Partner vs Driver**: The codebase uses "partner" throughout. `DriverRecord` and `DriverStatus` are deprecated aliases for `PartnerRecord` and `PartnerStatus` in `AdminDataContext.tsx`.
- **Admin access guard**: Screens under the admin panel check `useAdminAccess()` from `AdminAccessContext`. Sub-admin permissions are stored in settings entries.
- **Read-only guard**: Admin screens that must block writes in read-only mode use `useReadOnlyGuard()` from `hooks/useReadOnlyGuard.ts`.
- **IP access**: `IpAccessContext` / `utils/ipAccessStore.ts` gate access by IP. It is the innermost provider so it can conditionally block the entire app UI.
- **Diagnostics**: `/auth-diagnostics` is intentionally not shown in normal navigation.
