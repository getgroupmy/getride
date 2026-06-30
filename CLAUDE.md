# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**get.ride** is a ride-sharing mobile app (branded "Teksi") built with React Native/Expo, targeting iOS, Android, and web. It includes a full rider-facing interface, a partner (driver) onboarding and dispatch interface, and an extensive in-app admin panel for fleet/user/settings management.

The repository has two main subdirectories:
- `expo/` — the React Native / Expo Router application (all app code lives here)
- `supabase/` — database schema, migrations, seed data, and edge functions

**App registration:** `rork.json` at the repo root registers `"GET.ride"` with the Rork framework (`path: "expo"`, `framework: "react-native"`).

## Commands

All commands run from the `expo/` directory. The project uses **Bun** as the package manager. The `start*` scripts wrap the **Rork** CLI (`bunx rork start …`), not the bare Expo CLI.

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

The app uses **Expo Router** (v6) with a **flat** file-based route structure under `expo/app/`. There are no nested tab groups — all 144+ screens are declared as flat `Stack.Screen` entries in `expo/app/_layout.tsx`. Screen name prefixes:

- `admin-` — in-app admin panel (80+ screens)
- `partner-` — driver/partner interface

Auth flow order: `onboarding` → `phone-auth` → `otp-verify` → `name-entry` → `role-selection` → `pin-setup` / `pin-verify` → `index` (home map).

Tablet devices are automatically redirected to `/partner-teksi` instead of `/index`.

Special files: `+native-intent.tsx` (deep linking), `+not-found.tsx` (404 handler).

### Context Provider Tree

Providers are layered in `_layout.tsx` in this order (outermost first):

```
QueryClientProvider → LocationProvider → AuthProvider → ThemeProvider →
AdminDataProvider → AdminAccessProvider → DisplaySettingsProvider →
BrandingProvider → SessionTrackingProvider → EmergencyContactsProvider →
VoiceProtectionProvider → PushNotificationProvider → IpAccessProvider →
GestureHandlerRootView → RootErrorBoundary → TabletFrame → RootLayoutNav
```

Each context is created with `@nkzw/create-context-hook`, which produces a `[Provider, useX]` pair. Import from the context file directly (e.g. `import { useAuth } from "@/contexts/AuthContext"`).

### Key Contexts (`expo/contexts/` — 12 files)

- **AuthContext** — the most complex context. Manages two auth paths:
  1. **Supabase phone-OTP flow** (primary): `sendOtp` → `verifyOtp` → `registerUser` (sets PIN) → `signInWithPin` on subsequent logins.
  2. **Legacy local PIN flow** (offline/fallback): stores users in AsyncStorage only.

  On startup it pings `/auth/v1/health` (5s timeout); if unreachable it falls back to the cached local session. `authState.isSupabaseSession` tells you whether RLS-protected Supabase calls will work. Key exports: `authState`, `isLoading`, `serverReachable`, `isSupabaseAuth`, `serverError`, `serverDetails`, auth methods.

- **AdminDataContext** — holds all admin-facing data (partners, users, vehicles, settings entries). Syncs to/from Supabase via `utils/adminSync.ts` and caches to AsyncStorage under key `@admin_data_v3`. Settings are stored as `entries: Record<category, SettingEntry[]>` where each `SettingEntry.values` is a free-form key/value bag.

- **ThemeContext** — dark/light/system theme. Consume via `useColors()` hook (`hooks/useColors.ts`) which returns the right color palette for the active scheme from `constants/colors.ts`.

- **PushNotificationContext** — registers the device's Expo push token (via `utils/pushNotifications.ts`) and persists it to the `push_tokens` table. Broadcasts are sent from the admin "Push Notification" screen, which invokes the `send-push` Supabase edge function. Audiences: `all`, `partners`, or `users` (`drivers` is a legacy alias for `partners`).

- **LocationContext** — foreground location tracking + permissions management.

- **BrandingContext** — app name/logo/colors from `app_branding` table.

- **DisplaySettingsContext** — admin UI preferences.

- **SessionTrackingContext** — records user sessions to `user_sessions` table.

- **EmergencyContactsContext** — rider SOS contacts.

- **VoiceProtectionContext** — in-ride audio recording/protection.

- **AdminAccessContext** — admin access control; sub-admin permissions stored in settings entries. Consume via `useAdminAccess()`.

- **IpAccessContext** — IP-based access restrictions and enforcement.

### State Outside of Contexts

Most non-admin domain state lives in lightweight `utils/*Store.ts` / `utils/*store.ts` modules — plain async functions wrapping Supabase/AsyncStorage. Some use Zustand. Key stores:

- `brandingStore.ts`, `displaySettingsStore.ts`, `apiKeysStore.ts`, `elifeApiStore.ts`
- `ipAccessStore.ts`, `fareProviderStore.ts`, `fareAiStats.ts`
- `vehicleStore.ts`, `vehicleOnboardingStore.ts`, `vehicleDocumentsStore.ts`, `vehicleAssignmentStore.ts`
- `partnerOnboardingStore.ts`, `partnerTypeIconStore.ts`, `providerDocumentsStore.ts`
- `serviceAssignmentsStore.ts`, `rideRequestsStore.ts`
- `supportStore.ts`, `voiceProtectionStore.ts`

### Supabase Data Layer

- Singleton client in `utils/supabase.ts`. Hardcoded fallback URL/key in that file; override with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` env vars (place in `expo/env`).
- Always call `isSupabaseConfigured` / `getSupabaseOrThrow()` before using the client in new code.
- `uuidv4()` is exported from `utils/supabase.ts` for generating client-side primary keys before inserts.
- All data-access functions for the admin panel live in `utils/adminSync.ts` — thin wrappers around `supabase.from(...).select/upsert/delete`.

### Maps

- Native: `utils/maps.ts` re-exports from `react-native-maps` and adds helpers (`decodePolyline`, `getRoute`, `reverseGeocode`).
- Web: `utils/maps.web.ts` is the platform override for web builds.
- API key: `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` (set in `expo/env`). Key rotation logic lives in `utils/mappingClient.ts` (`runWithMappingRotation`).

### Platform / Responsive

`hooks/useResponsive.ts` exposes `isTablet` (shortest side ≥ 600px on native, ≥ 768px on web), `isLargeTablet`, `contentMaxWidth`, etc. Used for layout branching between phone and tablet UIs.

Files with a `.web.ts` / `.web.tsx` suffix are automatically used by Metro/Expo for web builds instead of the matching `.ts` / `.tsx` file.

## Screens Reference

### Rider Screens
- `index.tsx` — Home map
- `search.tsx` — Pickup/destination selection
- `ride-confirm.tsx` — Ride type & pricing
- `ride-tracking.tsx` — Live driver tracking
- `ride-running.tsx` — In-progress ride details
- `ride-detail.tsx` — Ride history detail
- `offer-fare.tsx` — Driver fare negotiation
- `map-picker.tsx` — Location selection modal
- `profile.tsx`, `edit-profile.tsx`, `profile-photo.tsx` — User profile
- `settings.tsx`, `language.tsx`, `dark-mode.tsx`, `navigation.tsx`, `distances.tsx` — Settings
- `rules-terms.tsx`, `change-number.tsx`, `change-pin.tsx` — Account management
- `teksi-ev.tsx` — Electric vehicle info

### Partner (Driver) Screens
- `partner-teksi.tsx` — Partner home/dispatch (default for tablets)
- `partner-ehailing.tsx` — E-hailing interface
- `partner-onboarding.tsx` — Driver signup/verification
- `partner-documents.tsx` — Document upload
- `vehicle-onboarding.tsx` — Vehicle registration

### Support Screens
- `support.tsx`, `support-chat.tsx`, `support-call.tsx` — Rider support
- `admin-support.tsx`, `admin-support-pool.tsx`, `admin-support-chat.tsx` — Admin support management

### Admin Panel (80+ screens)
All prefixed with `admin-`. Key groupings:

- **Auth:** `admin-login.tsx`, `admin-dashboard.tsx`
- **Partners:** `admin-partners.tsx` + variants (approved, unapproved, blocked, rejected, all, unapproved-docs, permit-pending/non-verified/verified), `admin-partner-add.tsx`, `admin-partner-edit.tsx`
- **Vehicles:** `admin-vehicles.tsx` + same variants, `admin-vehicle-add.tsx`, `admin-vehicle-edit.tsx`
- **Users:** `admin-users.tsx` + variants (approved, unapproved, blocked, rejected, deleted, all, unapproved-docs), `admin-user-add.tsx`, `admin-user-edit.tsx`
- **Documents:** `admin-documents.tsx`, `-users`, `-vehicles`, `-partners`
- **Orders:** `admin-orders.tsx`
- **Session History:** `admin-session-history.tsx`
- **Settings (45+ screens):** `admin-settings-<category>.tsx` covering service, display, vehicle make/model, partner type, required documents, vehicle services, site, referral, IP access, geo fencing, multi-gate (places & gates), airport areas, countries/states/cities, API keys, e-life API, payment type, driver incentive, leaderboard, rides, fare AI, fare AI logs, promo code, insurance (providers/types/durations/premium), free ride, fixed price, subscription plan, advertisement banners, push notifications, social links, world currency, app version, search radius, page list, email templates, Supabase settings, Rork chat, splash, app icon, EV (vehicle details, inventory, delivery advisors, finance options, order fee)

## Key Components (`expo/components/` — 39 files)

- **Layout:** `TabletFrame.tsx`, `RootErrorBoundary.tsx`, `AdminSideSheet.tsx`, `MenuSideSheet.tsx`
- **Modals:** `ConnectionStatusModal.tsx`, `AppIconChangeModal.tsx`, `AppAlertModal.tsx`, `PartnerModeSelectModal.tsx`, `VehicleSelectModal.tsx`
- **Admin Lists:** `AdminPartnerList.tsx`, `AdminVehicleList.tsx`, `AdminUserList.tsx`, `AdminCrudList.tsx`, `AdminSettingPlaceholder.tsx`
- **Maps:** `NearbyVehicleMarker.tsx`, `HeatmapOverlay.tsx`, `ServiceAreaPicker.tsx`, `PlaceGates.tsx`
- **Documents:** `DocumentViewerModal.tsx`, `DocumentUploadModal.tsx`, `DocumentMetadataEditModal.tsx`, `RequiredDocsChecklist.tsx`, `RequiredDocsUploader.tsx`, `VehicleDocsUploader.tsx`, `VehiclePhotosUploader.tsx`, `PdfRasterizer.tsx`
- **Pickers:** `VehicleMakeModelPicker.tsx`, `PartnerTypePicker.tsx`, `PaymentGatewayAccountPicker.tsx`
- **Ride UI:** `RollingFareAmount.tsx`, `OfferFareSideSheet.tsx`
- **Support:** `SupportChatView.tsx`, `SupportCallListener.tsx`, `AdminTripAudioPanel.tsx`
- **Misc:** `SplashScreenComponent.tsx`

## Database

The full, consolidated schema lives in `supabase/schema.sql` (idempotent — safe to re-run). Key tables: `profiles`, `partners`, `vehicles`, `partner_documents`, `settings_entries`, `app_settings`, `rides`, `support_tickets`/`support_messages`/`support_calls`, `push_tokens`, `push_notifications`, `user_sessions`, `ip_access_rules`, plus geo tables (`countries`/`states`/`cities`/`suburbs`/`airport_areas`).

`supabase/migrations/` holds **51 numbered migration files** (`0001_…` through `0051_…`). `schema.sql` is the canonical full snapshot; the migrations are the historical deltas that produced it. When adding tables/columns, update `schema.sql` and add a new numbered migration.

`supabase/functions/` holds two Deno edge functions:
- **`send-push/`** — fans a notification out to registered Expo push tokens using the service-role key and logs to `push_notifications`. Deploy with `supabase functions deploy send-push --no-verify-jwt`.
- **`ip-lookup/`** — IP geolocation service.

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

## Conventions

- **Path alias**: `@/` maps to `expo/` (configured in `tsconfig.json`). Always use `@/` for internal imports.
- **Icons**: Use `lucide-react-native` exclusively. Import named icons directly.
- **Settings categories**: New admin settings belong in `settings_entries` with a new `category` string. `AdminDataContext` groups entries by category automatically; add a corresponding screen under `app/admin-settings-<category>.tsx` and register it in `_layout.tsx`.
- **Partner vs Driver**: The codebase uses "partner" throughout. `DriverRecord` and `DriverStatus` are deprecated aliases for `PartnerRecord` and `PartnerStatus` in `AdminDataContext.tsx`.
- **Diagnostics**: `/auth-diagnostics` is a hidden screen (reachable from the connection error modal) for debugging Supabase connectivity and OTP delivery. It is intentionally not shown in normal navigation.
- **Admin access guard**: Screens under the admin panel check `useAdminAccess()` from `AdminAccessContext`.
- **IP access guard**: `IpAccessContext` enforces IP-based rules; `hooks/useReadOnlyGuard.ts` enforces read-only mode for restricted admin features.
- **Currency**: `constants/currency.ts` maps 25+ countries to currency info (default: MYR). Use `getCurrencyForCountry()` / `formatCurrency()` helpers.
- **Colors**: Primary `#000000`, secondary `#FFFFFF`, accent `#2dabe2`. Service tier colors: economy `#4F46E5`, comfort `#7C3AED`, premium `#1F2937`. Dark-mode variants defined in `constants/colors.ts`.
- **Vehicle catalog**: `constants/vehicleCatalog.ts` is a comprehensive make/model/year database.
- **Document AI**: `utils/documentAiVerify.ts` handles AI-based document verification; `utils/pdfRasterize.ts` converts PDFs for display.
