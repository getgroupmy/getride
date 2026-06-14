# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**get.ride** is a ride-sharing mobile app (branded "Teksi") built with React Native/Expo, targeting iOS, Android, and web. It includes a full rider-facing interface, a partner (driver) onboarding and dispatch interface, and an extensive in-app admin panel for fleet/user/settings management.

The repository has two main subdirectories:
- `expo/` — the React Native / Expo Router application (all app code lives here)
- `supabase/` — database schema, seed data, and setup scripts

## Commands

All commands run from the `expo/` directory. The project uses **Bun** as the package manager.

```bash
cd expo

# Install dependencies
bun install

# Start dev server (web preview via tunnel)
bun run start-web

# Start dev server (native, then press "i" for iOS or "a" for Android)
bun run start

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

### Context Provider Tree

Providers are layered in `_layout.tsx` in this order (outermost first):

```
QueryClientProvider → LocationProvider → AuthProvider → ThemeProvider →
AdminDataProvider → AdminAccessProvider → DisplaySettingsProvider →
BrandingProvider → SessionTrackingProvider → EmergencyContactsProvider →
VoiceProtectionProvider → PushNotificationProvider
```

Each context is created with `@nkzw/create-context-hook`, which produces a `[Provider, useX]` pair. Import from the context file directly (e.g. `import { useAuth } from "@/contexts/AuthContext"`).

### Key Contexts

- **AuthContext** (`contexts/AuthContext.tsx`) — the most complex context. Manages two auth paths:
  1. **Supabase phone-OTP flow** (primary): `sendOtp` → `verifyOtp` → `registerUser` (sets PIN) → `signInWithPin` on subsequent logins.
  2. **Legacy local PIN flow** (offline/fallback): stores users in AsyncStorage only.
  
  On startup it pings `/auth/v1/health` (5s timeout); if unreachable it falls back to the cached local session. `authState.isSupabaseSession` tells you whether RLS-protected Supabase calls will work.

- **AdminDataContext** (`contexts/AdminDataContext.tsx`) — holds all admin-facing data (partners, users, vehicles, settings entries). Syncs to/from Supabase via `utils/adminSync.ts` and caches to AsyncStorage under key `@admin_data_v3`. Settings are stored as `entries: Record<category, SettingEntry[]>` where each `SettingEntry.values` is a free-form key/value bag.

- **ThemeContext** — dark/light/system theme. Consume via `useColors()` hook (`hooks/useColors.ts`) which returns the right color palette for the active scheme from `constants/colors.ts`.

### Supabase Data Layer

- Singleton client in `utils/supabase.ts`. Hardcoded fallback URL/key in that file; override with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` env vars (place in `expo/env`).
- All data-access functions for the admin panel live in `utils/adminSync.ts` — thin wrappers around `supabase.from(...).select/upsert/delete`.
- `uuidv4()` is exported from `utils/supabase.ts` for generating client-side primary keys before inserts.
- Always call `isSupabaseConfigured` / `getSupabaseOrThrow()` before using the client in new code.

### Maps

- Native: `utils/maps.ts` re-exports from `react-native-maps` and adds helpers (`decodePolyline`, `getRoute`, `reverseGeocode`).
- Web: `utils/maps.web.ts` is the platform override for web builds.
- API key: `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` (set in `expo/env`). Key rotation logic lives in `utils/mappingClient.ts` (`runWithMappingRotation`).

### Platform / Responsive

`hooks/useResponsive.ts` exposes `isTablet` (shortest side ≥ 600px on native, ≥ 768px on web), `isLargeTablet`, `contentMaxWidth`, etc. Used for layout branching between phone and tablet UIs.

Files with a `.web.ts` / `.web.tsx` suffix are automatically used by Metro/Expo for web builds instead of the matching `.ts` / `.tsx` file.

## Database

Schema lives in `supabase/schema.sql` (idempotent). Key tables: `profiles`, `partners`, `partner_documents`, `settings_entries`, `app_settings`, `rides`.

RLS is enabled by default. User-facing writes require `auth.uid()` to match the row owner. Admin/back-office writes require the `service_role` key.

To bootstrap a new Supabase project:
```bash
export SUPABASE_DB_URL="postgres://postgres:PASSWORD@db.REF.supabase.co:5432/postgres"
./supabase/setup.sh          # creates schema + seeds
./supabase/setup.sh --reset  # wipe, rebuild, reseed
```

The `pin` and `login_pin` columns on `profiles` both store the user's 6-digit sign-in PIN. `login_pin` is the canonical column; `pin` is the legacy alias. Both must be kept in sync — see `registerUser` in `AuthContext.tsx` for the resilience logic that handles schema-cache lag.

## Conventions

- **Path alias**: `@/` maps to `expo/` (configured in `tsconfig.json`). Always use `@/` for internal imports.
- **Icons**: Use `lucide-react-native` exclusively. Import named icons directly.
- **Settings categories**: New admin settings belong in `settings_entries` with a new `category` string. `AdminDataContext` groups entries by category automatically; add a corresponding screen under `app/admin-settings-<category>.tsx` and register it in `_layout.tsx`.
- **Partner vs Driver**: The codebase uses "partner" throughout. `DriverRecord` and `DriverStatus` are deprecated aliases for `PartnerRecord` and `PartnerStatus` in `AdminDataContext.tsx`.
- **Diagnostics**: `/auth-diagnostics` is a hidden screen (reachable from the connection error modal) for debugging Supabase connectivity and OTP delivery. It is intentionally not shown in normal navigation.
- **Admin access guard**: Screens under the admin panel check `useAdminAccess()` from `AdminAccessContext`. Sub-admin permissions are stored in settings entries.
