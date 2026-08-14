# GET.ride — Expo app

The React Native / Expo Router application for **GET.ride**, a ride-sharing app
targeting iOS, Android, and web. It contains the rider interface, the partner
(driver) onboarding and dispatch interface, and the in-app admin panel.

**Framework**: Expo Router + React Native + TypeScript
**Package manager**: Bun
**Backend**: Supabase (schema and edge functions live in `../supabase/`)

See `../CLAUDE.md` for the full architecture guide.

## Requirements

- [Node.js](https://github.com/nvm-sh/nvm)
- [Bun](https://bun.sh/docs/installation)

## Getting started

All commands run from this `expo/` directory.

```bash
bun install

bun run start          # dev server; press "i" for iOS, "a" for Android
bun run start-web      # web preview
bun run start-web-dev  # web with verbose Expo debug logging
```

Other scripts:

```bash
bun run lint           # expo lint
bun run test           # jest (jest-expo)
bun run test utils/__tests__/fare.test.ts   # a single suite
```

Clear the Metro cache when things behave oddly:

```bash
bunx expo start --clear
```

## Environment

Environment variables go in `expo/env`:

- `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` — override the
  fallback Supabase project configured in `utils/supabase.ts`
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` — Maps / routing
- `EXPO_PUBLIC_TOOLKIT_URL` — base URL for the hosted AI toolkit used by the
  document verifier, profile-photo check, and admin AI chat

## Tests

Tests live in `utils/__tests__/*.test.ts` and cover the pure logic layer (fare
and taxi-meter maths, commission resolution, wallet accounting, CANBus/OBD-II
parsing, printer ESC/POS encoding, launch routing, and more). Only `*.test.ts`
files are collected as suites, so shared helpers can sit alongside them.
New domain logic in `utils/` should ship with a colocated test.

## Native builds

Several features depend on native modules that are not present in Expo Go
(CANBus/OBD-II readers over Wi-Fi, Bluetooth LE and Bluetooth MFi, thermal
receipt printing, screen-orientation locking). These need a development or
production build rather than an OTA update:

```bash
bun i -g @expo/eas-cli

eas build --profile development --platform ios
eas build --profile development --platform android
```

Then run against it with `bun run start --dev-client`.

## Deployment

```bash
eas build --platform ios      && eas submit --platform ios
eas build --platform android  && eas submit --platform android
```

See Expo's [iOS](https://docs.expo.dev/submit/ios/) and
[Android](https://docs.expo.dev/submit/android/) submission guides.

## Project structure

```
app/           # screens (Expo Router, flat routes; admin-* and partner-* prefixes)
components/    # shared UI components
contexts/      # React contexts (auth, theme, admin data, location, …)
hooks/         # shared hooks
utils/         # pure logic + Supabase/AsyncStorage stores
  canbus/      # OBD-II protocol layer and transports
  printer/     # ESC/POS receipt printing
plugins/       # Expo config plugins
assets/        # icons and images
app.json       # Expo configuration
```
