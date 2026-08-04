# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**get.ride** is a ride-sharing mobile app (branded "GET.ride"; "Teksi" — Malay for "taxi" — is the in-app name of the taxi driver mode, not the app) built with React Native/Expo, targeting iOS, Android, and web. It includes a full rider-facing interface, a partner (driver) onboarding and dispatch interface, and an extensive in-app admin panel for fleet/user/settings management.

The repository has two main subdirectories:
- `expo/` — the React Native / Expo Router application (all app code lives here)
- `supabase/` — database schema, seed data, and setup scripts

Design/spec documents live in `docs/`. Currently: `docs/get-wallet-mcash-flow.md`, the planned (not yet implemented) re-basing of GET.wallet onto the MCash e-money platform via an `mcash-proxy` edge function — only the MCash logo on the wallet top-up screen and the schema groundwork (migration `0068`: `profiles.mcash_*` identity columns, `wallet_transactions.status`/`mcash_ref`) exist in code today. Also `docs/canbus-integration.md`, the real OBD-II/ELM327 vehicle link behind the partner Teksi System Status panel and speed pill (`utils/canbus/*`, `hooks/useCanbus.ts`) — pure protocol layer + four transports (Wi-Fi TCP, Bluetooth LE, Bluetooth MFi, USB). Three of the four ship for real — Wi-Fi via `react-native-tcp-socket` (entry point `utils/canbus/tcpModule.ts`, pure availability rules in `utils/canbus/wifi.ts`), Bluetooth LE via `react-native-ble-plx` (+ its Expo config plugin, entry point `utils/canbus/bleModule.ts`) and Bluetooth MFi via `react-native-bluetooth-classic` (entry point `utils/canbus/mfiModule.ts`), each with a null `.web.ts` override — and work in any binary prebuilt since the dependency landed; a build made before that (an older TestFlight/App Store build) cannot use that transport at all and needs a *new native build*, not an OTA update. Each entry point reports "package resolves" and "native module linked into this binary" separately, since the JS half resolves either way. Missing-driver copy is runtime-aware (`utils/canbus/availability.ts` + `appRuntime.ts`): Expo Go is told to use a development build, an installed build is told to update, and each `TransportAvailability` carries a short `reason` plus a longer `guidance` string so no screen hardcodes build-specific wording. Only the USB module is still an optional peer dep behind a guarded lookup (a hardcoded `null` in `OPTIONAL_MODULES`) — Wi-Fi was one until it shipped for real, which is why installed builds used to tell drivers to update to a build that could never have contained the driver. `react-native-tcp-socket` needs its guarded require for a sharper reason than the Bluetooth packages: its `Globals.js` constructs a `NativeEventEmitter` at *import* time, which throws when the native module is absent. Wi-Fi also needs `NSLocalNetworkUsageDescription` (`app.json`) — iOS 14+ blocks the socket to the dongle's soft-AP without it. Bluetooth MFi is the iOS-only Apple External Accessory path for certified classic-SPP dongles (OBDLink MX+ &co.): paired in iOS Settings rather than scanned, gated on the accessory protocol strings shared between `MFI_ACCESSORY_PROTOCOLS` (`utils/canbus/config.ts`) and `UISupportedExternalAccessoryProtocols` (`app.json`), with the pure matching logic in `utils/canbus/mfi.ts`. Its Android side is deliberately not autolinked (`expo/react-native.config.js`) — MFi is iOS-only by design and the library's `android/build.gradle` still targets RN 0.71 / AGP 3.4. The accessory session's options come from `mfiConnectionOptions`: iOS force-casts `charset` to a `UInt32`, so it must be a number and never an encoding name, and writes go in as plain text because the library base64-encodes them itself. Drivers add/select their reader from Settings → OBD-II (CANBus) reader (`app/obd2-reader.tsx`, saved device-locally by `utils/canbusAdapterStore.ts`); that row only shows for accounts that are also partners (`hooks/useIsPartner.ts`), and `useCanbus` auto-connects to whatever is selected there. Every `useCanbus` mount publishes its session into a shared registry (`utils/canbus/liveStatus.ts`) — a dongle serves one client at a time, so read-only consumers ask the registry instead of opening a competing link: `hooks/useCanbusStatus.ts` is how the partner side menu knows to reveal its **Vehicle information** row (`VEHICLE_INFO_MENU_ITEM_ID`, admin-configurable like any other menu item but additionally gated on `status.linked` — Demo Mode does not count), and `app/vehicle-information.tsx` borrows the Teksi screen's live session rather than mounting its own. That screen reads everything the reader exposes in one pass (`utils/canbus/vehicleScan.ts`): adapter identity, the mode-01 support bitmasks and every parameter they list (decoded through the ~70-entry read-once `utils/canbus/pidCatalog.ts`, raw bytes for anything uncatalogued, so a supported PID is never silently dropped), readiness monitors, the mode-09 identity block (VIN/CalID/CVN/ECU name, ISO-TP multi-frame reassembled) and all three DTC stores — all parsing pure and tested in `utils/canbus/vehicleInfo.ts`. Leading that screen is the odometer / fuel level / distance-to-empty card: the first two are read straight off the bus (PIDs `A6` and `2F`, picked out of the scan by the `numeric` field `VehicleReading` carries beside its formatted value, and kept live from the 1 Hz sweep), but the third is *not* an OBD-II parameter — generic OBD-II publishes neither tank capacity nor distance to empty — so `utils/canbus/fuelRange.ts` reconstructs it from a driver-entered tank size (`utils/vehicleFuelStore.ts`, device-local like the adapter book, keyed to the VIN so a different car starts fresh) divided by a consumption figure resolved in priority order: measured from this vehicle's own burn > live fuel rate (PID `5E`, only ≥ 10 km/h) > live MAF-derived > the entered average. Every result names its source, so an assumption is never rendered as a measurement, and `learnConsumption` only accepts an odometer/level pair spanning ≥ 20 km with a believable drop — a refuel, a different vehicle or an out-of-band result re-baselines rather than poisoning the average. `OBD_PIDS` stays small on purpose: it is the 1 Hz sweep, and the scan pauses that sweep (`CanbusClient.setPollingPaused`) because the adapter answers one command at a time. Writes are the other half and stay deliberately short — generic OBD-II defines exactly one write every vehicle must accept (mode 04, clear codes), so `VEHICLE_WRITE_ACTIONS` is that plus three adapter-level operations, each tagged ECU vs Reader, each behind a warning popup, and each gated by `evaluateWriteAvailability`: no link → blocked, Demo Mode → blocked (simulated telemetry must never be presented as having written to a car), and an ECU write while `speed > 0` → blocked, re-checked against the live session at confirm time rather than trusting what the row rendered with. The same link drives **Meter Digital** (`app/meter-digital.tsx`, reached from the Meter Digital button above Start Pickup on the Teksi driver-permit screen): the in-app taxi meter, which bills on the vehicle's OBD-II speed (PID 0D) and silently falls back to GPS whenever the reader is absent, stale (`OBD_STALE_MS`), or in Demo Mode — simulated telemetry never bills a fare. All accrual and tariff maths are pure and tested in `utils/taxiMeter.ts` (the screen only owns the 1 Hz clock and the sensors); it mirrors `calculateFare`'s two TEKSI tariffs, except the old tariff's 36-second increments are billed from the time actually accrued past the first kilometre rather than a proportional estimate. Beside the tariff sits the shift: the DAY / NIGHT keys are the `multiplier` `computeMeterFare` already took (`NIGHT_MULTIPLIER`, +50% on the 00:00–06:00 shift, preselected from the clock by `isNightPeriod`), and the EXTRA keys are the charges a meter cannot measure — tolls, booking, luggage — clamped by `adjustExtra` and added on by `meterGrandTotal`. The screen is drawn as the instrument it replaces: a fixed dark console (deliberately *not* themed — a white screen on a windscreen mount at night is a hazard) with seven-segment readouts (`components/SegmentDisplay.tsx`: platform monospace plus a faint ghost of the unlit segments, which is what sells the LCD look without bundling a segment font) and a five-tab foot — meter, trip log, printer, OBD-II, settings. Those five are panels of one instrument rather than screens of their own, so the header's back arrow (and the Android hardware/gesture back) returns to the meter from any other tab, and leaving the console is a *mode change* rather than a step back: back from the meter itself raises a popup offering passenger mode (`/`), e-hailing (`/partner-ehailing`) or staying put, and while a fare is accruing it does neither — the key is dead and the hardware back is swallowed, so a running hire cannot be walked out of (`resolveMeterBack`, pure + tested, decides all three cases; the panel-return wins even while running, since that is inner navigation). The portrait notice's back still exits, since with the console undrawn a tab change would look like a dead button. What the TRIP STATUS panel says is pure and tested in `utils/meterDashboard.ts`, and it never claims a source the meter does not have. Its headline is the *connection type* — `describeMeterConnection`: GPS + OBD-II, one of the two on its own, or the reason there is neither — with Demo Mode flagged beside the type rather than folded into it (a simulator is not a sensor), and, while a hire runs, the billed source shown separately, since what is linked and what the last sample billed on are different questions. An open hire adds the two facts that belong to the moment the passenger got in and cannot be recovered later: the odometer the cluster showed (mode-01 PID A6, read once through `sendCommand` — a car that does not implement it renders a dash rather than a number the meter invented) and where it was (reverse-geocoded, falling back to the raw fix, and backfilled from the first fix when a hire opened before one arrived). A hire also *opens* on the vehicle link (`evaluateMeterStart`): without one, START is greyed and a press raises the connect popup instead of a fare — the press is held, the link attempted, and the hire begins by itself when the car answers. GPS stays the fallback for a hire already under way (resuming from a pause is never gated), and Demo Mode is let through the gate as the admin-gated simulation it is, told plainly that it bills on GPS. Ending a hire writes it to the device-local trip log (`utils/meterTripsStore.ts`, the meter's paper roll — `buildMeterTrip` re-prices from the state being stored rather than trusting what the screen rendered) and offers the receipt (`utils/meterReceipt.ts`) through the platform print service, since there is no thermal-printer driver in this build and the printer tab says so rather than inventing a connection. A record carries both ends of the hire (`pickup` / `dropoff`, each a `MeterWaypoint`: odometer + position), and the log row, the end-of-hire total and the receipt all print them — but the readings do not all land at once (the adapter answers after the fare is settled, the geocoder later still), so the record is written immediately and completed by `patchMeterTripWaypoints`, which may only ever touch the two ends: nothing that was measured or charged is rewritable. An end the meter could not stamp, or a record from a build before the ends existed, prints no line rather than a line of dashes. Meter Digital is **landscape-only** — it is read off a dash mount, so `hooks/useLandscapeLock.ts` pins the device to landscape (both directions) while the screen is focused and hands rotation back to the app default (`app.json` `orientation: "default"`) on blur. Nothing on that screen is drawn at a fixed point size: every padding, corner, icon and word comes from `utils/meterScale.ts` (pure + tested), which fits the whole console to the viewport it is drawn into — the scale is the *tighter* of the two axis ratios, so a wide-but-short glass never sizes off its width, and each segment readout is fitted arithmetically to the value it is drawing inside its own panel (`fitDigits` + `fitReadout`, monospace) rather than to a share of the screen or to the longest string the field might ever hold — so the TIME and DISTANCE pair re-fits as the clock gains an hour digit or the distance a hundreds digit, taking the tighter of the two so the pair still matches. On top of that the screen's `FitText` shrinks unpredictable strings to their box and refuses the OS font scale, so a wound-up accessibility setting cannot push the fare out of its panel; panels clip as the backstop. `expo-screen-orientation` sits behind a guarded require (`utils/screenOrientation.ts`) for the same reason as the CANBus transports: the JS resolves anywhere but the native side only exists in a binary prebuilt since the dependency landed. Where the pin cannot happen — the web build, an older binary — a portrait viewport gets `components/RotateDeviceNotice.tsx` instead of a squeezed meter. That is a *render gate*, not an overlay: `resolveOrientationGate` (pure + tested in `utils/orientationLock.ts`) reads the viewport rather than the lock's own verdict and returns `ready` / `rotate` / `waiting`, and the screen returns early on anything but `ready`, so the console is never drawn — nor stacked into one column — in portrait. It re-gates on every focus, because `useLandscapeLock` re-requests the pin and resets to `pending` each time the screen is focused: coming back from the reader settings with the device upright meets the notice again. `waiting` (portrait + `pending`) draws neither console nor notice, and the hook holds `pending` for a settle window (`LOCK_SETTLE_MS`) after the OS accepts the lock, since `lockAsync` resolves before the device has finished turning — so a phone that is mid-rotation never flashes the notice. Everything above the gate (the link, the fix, the 1 Hz clock, an open hire) keeps running while the notice is up: turning the phone upright must not cost the driver a fare in progress.

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

Tests live in `expo/utils/__tests__/*.test.ts` and cover the pure logic layer (fare calculation, commission resolution, wallet accounting, coin-transfer approval, ride-request schema degradation, restore-target mapping, PIN lockout parsing, IP access evaluation, API-key rotation, polyline decoding, address formatting, partner document-check logic, UUID generation). Config is in `expo/jest.config.js`; `expo/jest.setup.js` mocks AsyncStorage (official in-memory mock), `react-native-maps`, and `expo-location`. `expo/test-utils/supabaseMock.ts` provides a chainable, queue-based mock of the Supabase client — tests `jest.mock("@/utils/supabase")` and swap in `createSupabaseMock().client`, queueing per-query results and asserting on the recorded chains. Only `*.test.ts` files are picked up as suites, so shared helpers can live alongside them. There are no component/screen tests yet — new domain logic in `utils/` should ship with a colocated test.

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

Real ride matching goes through the `ride_requests` table via `utils/rideRequestsStore.ts` (no context — plain async functions plus Supabase realtime subscriptions). A rider inserts an `open` request; online partners subscribe to open requests in realtime, accept one (claiming it), and progress it through `accepted` → `arrived` → `on_trip` → `completed` (or `cancelled`/`expired`; open requests expire after 7 minutes, `REQUEST_EXPIRY_MS`). The rider watches their own request row for status changes. A database trigger (migration `0051`, reworked in `0067`) fires the `send-push` edge function to notify the partner audience whenever a new open request is inserted: all push webhook triggers post through the shared `send_push_webhook` helper (`pg_net`), which requires only the Supabase Vault secret `project_url` — the optional `service_role_key` secret is attached as a bearer when present, but `send-push` is deployed `--no-verify-jwt` so it isn't required.

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
- **GET.coin** (`get_coin`, migrations `0061`–`0065`) — reward coin denominated in GC, used in both modes; must stay non-negative. The GC↔RM rate (and optional market-speculated pricing/supply cap) is set from Admin → Settings → Get Coin (`utils/getCoinStore.ts`). Coins are earned as ride rewards (`wallet_award_ride_coins` RPC, idempotent per ride), redeemed against QR payments and fares, bought/sold against GET.wallet on `app/wallet-trade.tsx`, and sent P2P between accounts with recipient approval (migration `0065`, `utils/transferRequestsStore.ts`): the sender's confirm creates a pending `wallet_transfer_requests` row (`wallet_request_coin_transfer` RPC, recipients resolved by account id or phone server-side), the recipient gets a push + in-app popup (`components/IncomingTransferPopup.tsx`, mounted in `_layout.tsx`) naming the sender and amount, and the coins move 1:1 without minting only when they accept (`wallet_respond_coin_transfer` RPC); requests expire after 15 minutes, and on pre-`0065` databases the store falls back to the instant `wallet_transfer_coins` RPC (migration `0064`). Balances are ledger-driven: `wallet_transactions` rows drive `wallets.balance` via the `0060` trigger.

**Wallet security (migration `0066`)**: clients can only *read* `wallets`/`wallet_transactions` — every balance-changing operation goes through an owner-scoped `SECURITY DEFINER` RPC that asserts `auth.uid()` matches the wallet owner (`wallet_assert_caller`). QR payments use `wallet_pay`, coin trading uses `wallet_trade_coins` (rate anchored server-side to the admin peg ± the market swing band; supply cap enforced), and fare coin redemption uses `wallet_redeem_fare_coins` (idempotent per ride via `ride_requests.fare_coins_redeemed_at`). `wallet_award_ride_coins` additionally requires the caller to be the ride's rider and the ride to be `completed`; `wallet_charge_ride_commission` requires the ride's partner and ignores client-supplied rates (always resolved server-side). On pre-`0066` databases `walletStore.ts` falls back to the old direct ledger inserts; when the database rejects the caller (`not_authorized`, e.g. a legacy local-PIN session) the store surfaces a sign-in prompt instead of failing generically.

On trip completion the platform commission is deducted from GET.credit through the `wallet_charge_ride_commission` RPC (migration `0057`) — atomic and idempotent (the charge is stamped on the ride row via `commission_charged_at`, so it can never apply twice).

Commission *rates* are configurable from Admin → Settings → Commission Rates (`app/admin-settings-commission.tsx`, `utils/commissionStore.ts`, table `commission_rates` from migration `0058`): one master platform default plus overrides resolved in priority order user → suburb → city → state → country → master → hardcoded 15% (`DEFAULT_COMMISSION_RATE`).

Both stores degrade gracefully: if the wallet/commission tables aren't in the live database yet, they fall back to device-local AsyncStorage copies and report `source: "local"` so callers can surface a notice.

### TEKSI EV order flow

`app/teksi-ev.tsx` is the customer car-buying wizard (menu item "Book TEKSI EV"), nine steps: model → specification → order fee → ownership → plate → financing → advisor → schedule → delivery. Every catalog it reads is admin-configured (`ev-vehicle-details`, `ev-vehicle-inventory`, `ev-delivery-advisors`, `ev-finance-options`, `ev-order-fee`, `ev-delivery-checklist`), and the order itself is one `ev-orders` entry created when the order fee is paid, then patched step by step. The fee comes from `resolveOrderFee` (vehicle country → account country → ID country) and is collected through the gateway attached to that fee row, falling back to the platform default.

Shared order logic lives in `utils/evOrders.ts` (pure, tested): the status vocabulary (`pending` → `assigned` → `in-progress` → `ready_for_delivery` → `delivered`, plus `cancelled`) with `normalizeEvOrderStatus` tolerating stored spelling variants, the delivery-checklist parse/merge helpers, and `deriveEvOrderStep`, which maps a stored order back onto a wizard step. Both sides of the flow use it: the customer wizard and the back office (`app/admin-orders.tsx`), where a Delivery Advisor is assigned and the handover checklist is filled in and submitted (`checklistResults` / `checklistSubmitted`) for the customer to accept — accepting is what marks the order `delivered`.

Orders resume rather than restart: `utils/evOrderStore.ts` remembers the in-flight order id on the device, and if that's absent the wizard adopts this account's newest unfinished order. Writes need an authenticated Supabase session (owner-scoped RLS, see Database); on a legacy local-PIN session the checkout says so and the order is held locally until it can sync.

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

`supabase/functions/` holds Deno edge functions. There are three: `send-push` fans a notification out to registered Expo push tokens using the service-role key and logs to `push_notifications`; `ip-lookup` resolves the caller's public IP and ISP/geolocation (the mobile client can only see its LAN IP); `ai-route-proxy` runs the fare-AI route estimation (provider/key failover loop from `utils/geminiRoute.ts`) server-side — it reads the `fare_ai_provider` settings row with the service-role key so the provider API keys never reach the client, and logs attempts to `fare_ai_responses`/`fare_ai_key_states` exactly like the client used to. `geminiRoute.ts` calls the proxy first and only falls back to the legacy client-side loop when the function isn't deployed. Deploy with `supabase functions deploy <name> --no-verify-jwt`.

RLS is enabled everywhere and — since migration `0069` — scoped rather than permissive. The central helper is `caller_is_admin()` (true for direct DB sessions, the service role, and profiles holding an `admin_access` row):

- **`ride_requests`** is participant-scoped: open requests are readable by everyone (the partner queue needs them), everything else is rider/partner/admin only. Riders insert rows carrying their own `auth.uid()`; partners claim/offer on open rows but must stamp `partner_id = auth.uid()` in the same update; `rider_id` is immutable after insert (trigger). Consequence: writes require an authenticated Supabase session — `rideRequestsStore.ts` surfaces `isPermissionDeniedError` / `RIDE_SIGN_IN_MESSAGE` for legacy local-PIN sessions, and partners no longer receive realtime UPDATEs for requests claimed by someone else (stale incoming cards self-dismiss on their countdown; the `status = 'open'` claim guard keeps the accept race safe).
- **Admin-managed config tables** (geo tables, settings, branding, commission/coin settings, IP rules, insurance/EV catalogs, …) keep public reads; writes are admin-only.
- **Personal/PII tables** (`emergency_contacts`, `user_sessions`, `user_location_history`, `voice_protection_recordings`, `support_*`, `provider_documents`, `vehicle`/`vehicle_documents`/assignments, `fare_ai_responses`) are owner-or-admin scoped. Push tokens are admin-only at the table level; devices register via the `push_register_token`/`push_unregister_token` RPCs (`adminSync.ts` falls back to the legacy direct writes on pre-`0069` databases). The support-agent roster comes from the `support_agents` RPC (same fallback pattern in `supportStore.ts`).
- **`admin_access`** writes require sub-admin edit access (the `0010` public-write policies are gone). First-run bootstrap: the `admin_access_bootstrap()` RPC makes the first authenticated caller the `'*'` admin on an empty table — the sub-admin screen retries through it automatically.
- From `0066`: the wallet tables are read-only to clients (writes go through owner-scoped RPCs — see Wallets above), and the `app_settings` row `fare_ai_provider` (secret AI provider keys) is only visible to profiles with an `admin_access` row or the service role — non-admin clients get fare estimates through the `ai-route-proxy` edge function instead.
- Storage: buckets stay public (existing `getPublicUrl` links keep rendering) but the broad per-bucket SELECT (listing) policies are dropped and writes are admin- or owner-scoped; `voice-protection` objects are readable only by their owner's folder or admins (signed URLs).
- From `0080`: **`ev_orders`** is the one *owner-scoped* settings category. TEKSI EV orders are created by the customer (see EV order flow below), so they cannot live in the admin-write-only `settings_entries`; they get their own table with the same `SettingEntry` shape plus `user_id` (defaulted from `auth.uid()`, frozen by trigger), readable/writable by owner-or-admin and deletable by admins only. `adminSync.ts` routes the category through `OWNER_SCOPED_CATEGORY_TABLE_MAP` and falls back to `settings_entries` when the table is missing (`isMissingTableError`); `AdminDataContext` keeps local-only rows of these categories across a remote fetch and retries their upsert, so an order created offline is never dropped.

Owner-scoped tables (like `profiles`) require `auth.uid()` to match the row; admin/back-office writes otherwise use the `service_role` key.

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
- **Admin access guard**: Screens under the admin panel check `useAdminAccess()` from `AdminAccessContext`. Sub-admin permissions are stored in settings entries. View vs. edit access is a separate axis: `hooks/useReadOnlyGuard.ts` derives a `page` key from the current route (e.g. `/admin-settings-display` → `admin-settings-display`), calls `canEdit(pageKey)`, and returns a `guard()` helper mutation handlers call first — it shows a "Read-only" alert and returns `false` when the signed-in sub-admin can view but not edit that page.
- **Graceful schema degradation**: newer `utils/*Store.ts` modules (wallets, commission rates) fall back to AsyncStorage when their tables/columns are missing from the live database, and `rideRequestsStore` retries writes without columns the DB reports as missing. Follow this pattern when adding features that depend on new migrations — the app must keep working against older databases.
- **Mock/test features**: `app/admin-settings-mock.tsx` exposes toggles (mock users/partners on the map, rider trip simulation, partner drive simulation) persisted via `DisplaySettingsContext`. Gate any demo/simulation behavior behind these flags rather than hardcoding it.
