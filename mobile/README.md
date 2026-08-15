# GET.ride — rebuild

The rebuilt Expo application. It lives alongside the legacy app in `../expo/`
rather than replacing it, so each phase ships against the same Supabase project
and the old app keeps running until a surface is actually replaced.

Plan and rationale: see the rebuild scoping document.

## Status

**Phase 01 — Foundations: complete.**
**Phase 02 — Rider core: complete.**
**Phase 03 — Partner core: complete.**
**Phase 04 — Money: complete.**
**Phase 05 — Instruments: complete.**
**Phase 06 — Back office: complete (see `../admin/`).**
**Phase 07 — Long tail: partial (see below).**
**Phase 08 — TEKSI EV ordering: complete.**
**Phase 09 — Component tests: first cut.**
**Phase 10 — Component tests: the three highest-value screens.**
**Phase 13 — Security review of auth and money, with fixes.**

| | |
|---|---|
| Logic modules ported | 108 |
| Tests | 71 suites, 1,222 passing |
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

### Phase 04 — money

The three wallets, and the flows that move value between them.

| Screen | Does |
|---|---|
| `wallet` | All three balances; top up GET.wallet, recharge GET.credit |
| `wallet-history` | The ledger, per wallet |
| `wallet-trade` | Buy/sell GET.coin against GET.wallet |
| `wallet-transfer` | Send GC to another account (recipient must accept) |
| `IncomingTransferPopup` | Mounted globally; accept or decline incoming GC |

How the risk is contained:

- **The client never computes a balance.** Since migration 0066 the wallet
  tables are read-only to clients and every balance-changing operation goes
  through an owner-scoped `SECURITY DEFINER` RPC. `WalletContext` re-reads what
  the ledger reports, and applies the `balances` an action already returned
  rather than making a second round trip that could disagree with it.
- **The displayed coin rate is indicative only.** `wallet_trade_coins` anchors
  the executed rate server-side to the admin peg ± the swing band and enforces
  the supply cap, so a stale or tampered client rate cannot move coins at a
  price the operator never sanctioned. The screen says so.
- **Sending coins does not move them.** It creates a pending request the
  recipient accepts (migration 0065); coins move 1:1 only on acceptance, and
  expire after 15 minutes. On a pre-0065 database the store falls back to the
  instant RPC and reports `immediate` — a materially different outcome for the
  sender, so it is worded differently rather than glossed as "sent for
  approval".
- **The transfer prompt is global.** A transfer can arrive while the recipient
  is anywhere in the app and lapses in 15 minutes, so it cannot wait for them to
  open their wallet. An answered request is dequeued whatever the server said,
  so a failure cannot wedge a modal over the whole app.
- **Rewards and commission are idempotent and quiet.** Ride coins are awarded on
  completion via an RPC anchored on `coin_rewarded_at`; a failure is logged
  rather than shown, because the ride finished fine and the ledger reconciles
  server-side.
- **A negative GET.credit is a normal state**, not an error — a driver owing
  commission is expected, so it is shown plainly with a recharge prompt.
- **A degraded read is labelled.** When the store falls back to the device-local
  copy (`source: "local"`), both the wallet and history screens say the numbers
  may be out of date rather than presenting a cached balance as live.

### Phase 05 — instruments

The vehicle link and the taxi meter it drives.

| Screen | Does |
|---|---|
| `meter-digital` | The console: fare, time, distance, tariff/shift keys |
| `obd2-reader` | The driver's reader book; connect, Demo Mode, per-transport availability |
| `meter-printer` | Mini ESC/POS thermal printer; in-app BLE scan, test print |
| `vehicle-information` | One-pass scan: adapter, identity, every supported PID, fault codes |

Almost nothing here was written from scratch — the whole protocol and arithmetic
layer arrived in Phase 01 and is already tested. What this phase adds is the
hooks (`useCanbus`, `useCanbusStatus`, `usePrinter`, `useLandscapeLock` — 840
lines, ported intact), two components, and the screens.

What the console honours:

- **It is deliberately not themed.** A white screen on a windscreen mount at
  night is a hazard, so the console has its own fixed dark palette.
- **Simulated telemetry never bills.** In Demo Mode the OBD speed is withheld
  so the sample falls through to GPS, exactly as if no reader were linked.
- **Landscape is pinned, not gated.** `useLandscapeLock` holds the pin, and
  `FixedLandscapeStage` turns the *content* where the platform won't turn the
  device. There is no rotate notice: a portrait viewport draws a tighter
  console rather than something standing in front of the meter.
- **A running hire cannot be walked out of.** The back key is inert while the
  meter is accruing.
- **The scan pauses the 1 Hz sweep**, because the adapter answers one command at
  a time — and always releases it, including on failure or unmount, since a
  paused sweep stays paused and would leave the meter blind to speed.
- **Availability distinguishes "package resolves" from "native module linked".**
  A build made before a transport shipped needs a *new native build*, not an OTA
  update, and that wording comes from `utils/canbus/availability.ts` rather than
  being hardcoded per screen.

Native configuration: the `react-native-ble-plx` config plugin,
`NSLocalNetworkUsageDescription` (iOS 14+ blocks the socket to a Wi-Fi dongle's
soft-AP without it), and `UISupportedExternalAccessoryProtocols` — which is
checked against `MFI_ACCESSORY_PROTOCOLS` in code, since MFi fails silently if
the two drift. `react-native.config.js` keeps `react-native-bluetooth-classic`
off Android, where its Gradle pins would break an RN 0.81 build.

### Not verifiable here

The four transports and the printer need **real hardware**. Nothing in a
simulator, a web build or CI exercises a Wi-Fi dongle, a BLE peripheral, an MFi
accessory or an ESC/POS printer — typecheck and lint confirm the wiring, not
that a car answers.

`HARDWARE-CHECKS.md` is the checklist for that session: how to get a
development build onto a device, what to bring, what to check, and what
"correct" looks like for each.

### Phase 07 — long tail (partial)

| Screen | Does |
|---|---|
| `support` | Ticket list; opens or reuses a chat |
| `support-chat` | The conversation |
| `referral` | Invite code, share, copy |
| `emergency-contacts` | SOS contacts, add/remove/call |

New tested logic: **`utils/emergencyContactsStore.ts`** (16 tests). The legacy app
kept these rules inside a React context, so what counted as a usable contact
lived in a component and could not be tested. The validation, duplicate
detection and the add-limit are now pure — a name is *required*, because in an
emergency the rider is picking from a list under stress and a bare number is
unusable; numbers compare on digits so formatting never makes two contacts of
one; and a failed write is surfaced rather than swallowed, since a contact the
rider believes is saved but is not would only be discovered in the moment it
was needed.

`support-chat` polls on a slow timer rather than claiming to be live: the
support store has no realtime channel, so pretending otherwise would be a lie in
the UI. Sending refetches immediately, and pull-to-refresh is there for someone
who does not want to wait.

`referral` derives the code from the account id rather than storing it, so there
is nothing to keep in sync, and builds the link with `ExpoLinking.createURL` so
it carries whatever scheme the build actually uses.

### Phase 08 — TEKSI EV ordering

`teksi-ev` — the customer purchase wizard, nine steps from model to handover.

Every catalogue is admin-configured (`ev-vehicle-details`,
`ev-vehicle-inventory`, `ev-order-fee`, `ev-finance-options`,
`ev-delivery-advisors`), so the wizard shows what the operator is actually
selling rather than anything hardcoded.

Two decisions carry the screen:

- **The step is derived, not tracked.** `deriveEvOrderStep` — pure and already
  tested — reads the stored order and returns the furthest step satisfied. That
  is what makes an abandoned order resumable with no second source of truth to
  drift out of sync, and it is why the financing step just asks for what the
  predicate requires instead of re-deciding when financing is complete.
- **The order row exists only from the deposit step onward.** Model and
  specification are held locally and committed when the fee is paid, because
  paying the fee is what places the order.

Resuming prefers the id this device remembers, then falls back to this
account's newest unfinished order — so a reinstall does not strand one. Text
fields commit on blur rather than per keystroke: each save is a network round
trip against the order row.

### Phase 09 — component tests

The rebuild had 1,172 tests and **none of them touched a screen**. This is the
first cut at closing that, aimed at the two surfaces where a defect costs
money rather than polish.

| Suite | Covers |
|---|---|
| `components/__tests__/IncomingTransferPopup.test.tsx` | 10 tests — accept/decline, live arrival, expiry, queue depth, signed-out |
| `app/__tests__/meterDigital.test.tsx` | 7 tests — which sensor bills, and that Demo Mode never does |

Two things worth recording:

- **The meter suite drives the 1 Hz clock with fake timers.** Written against
  the real clock, the assertions raced `waitFor`'s default timeout — the kind of
  test that passes on one machine and fails on another. It is deterministic now
  (~20 ms per test instead of ~1 s).
- **A test found a real defect.** Declining an incoming transfer applied
  balances and triggered a wallet refresh, though a decline cannot move coins.
  Fixed in the component rather than by weakening the assertion.

**Tooling note:** `@testing-library/react-native@14` does not work in this
setup — `render()` returns an object with no query methods and `screen` reports
that render was never called. Pinned to `^13`, which works.

### Phase 10 — the three screens named next

The three surfaces flagged at the end of Phase 09, now covered — 25 tests.

| Suite | Covers |
|---|---|
| `app/__tests__/rideConfirm.test.tsx` | 8 — the quote, the request it creates, and the failure paths |
| `app/__tests__/rideRunning.test.tsx` | 9 — trip progression and the commission charge |
| `app/__tests__/walletTrade.test.tsx` | 8 — the balance guards, rate and supply cap |

What these actually pin down:

- **The quoted fare uses the shared tariff arithmetic.** `calculateFare` is left
  unmocked on purpose — a quote that disagreed with the meter is the exact
  defect this screen exists to avoid, so the test asserts against the real
  function rather than a stub that could drift with it.
- **Commission fires once, only after completion,** never on a zero fare or a
  failed completion — and a failed charge is not shown to the driver as a failed
  trip, because the fare is collected either way and the ledger reconciles
  server-side.
- **Trade guards run before the RPC.** A buy larger than the wallet or a sell
  larger than the coin balance is refused client-side, and the trade that does
  execute carries the resolved rate and the operator's supply cap rather than
  silent defaults.

Two test-harness notes, both of which cost time to find:

- A `Pressable` disabled until data arrives cannot be pressed as soon as it is
  *found*. `ride-confirm`'s button keeps a constant accessibility label and
  changes only its text, so the text is what signals the press will land.
- `clearMocks` strips `jest.fn().mockResolvedValue(...)` implementations between
  tests. Store mocks that must survive are plain `async` functions, otherwise
  they resolve to `undefined` and fail inside the screen rather than in an
  assertion.

### Phase 13 — security review

Twelve phases built auth, wallets and RLS-dependent code without ever reviewing
any of it. This is that review. Two real defects, both fixed.

**The PIN was set but never asked for.** `pin-setup` ran during sign-up and
`setPin` worked, but `verifyPin` was dead code and no `pin-verify` screen
existed. Supabase persists the session, so every relaunch opened straight into a
signed-in wallet — anyone holding an unlocked phone had the account. The PIN's
real job was never a credential exchange (the RPC verifies, it does not mint a
session); it is a lock on the app, and it was missing.

Fixed with `utils/appLock.ts` (pure, 8 tests) and `app/pin-verify.tsx`. The
unlocked flag lives in memory and is never persisted — a lock that survives
relaunch in storage is a lock that can be cleared by editing storage. Sign-out
re-locks, so the next account does not inherit an unlocked app. There is no
"skip": the way past is the PIN or signing out.

**Fourteen screens had no auth guard of their own.** Only `index` and
`welcome-back` checked, but the app declares a URL scheme, so a deep link mounts
a route without passing through either. RLS still protected the *data* — writes
degraded to no-ops — but a signed-out or locked device rendered a wallet as
though it were usable.

Fixed with `hooks/useRequireAuth.ts`, applied to every screen that reads an
account id. The guard waits for `profileLoaded` before deciding, because
`hasPin` is false until the profile lands and acting early would wave a locked
account straight through.

Checked and found clean: nothing logs a PIN, token or session; the hardcoded
Supabase fallback is an `anon` key (public by design, though a fallback does
mean a misconfigured build silently talks to production); and the phone number
in the `tel:` link is validated before it gets there.

### Still untested

Five surfaces are now covered. The remaining ~25 screens are still
typecheck-and-lint only — the auth flow, search, the partner queue, the wallet
home and history, the instrument screens, and the long tail. None of them moves
money or bills a fare, which is why they ranked below the five that do.

### Not built in Phase 07

Named rather than quietly dropped:

- **Support calls** — voice/video (`startCall`, `updateCallStatus`) needs a WebRTC
  layer the rebuild does not have yet.
- **Voice protection** — in-ride audio recording, with its own storage bucket and
  owner-scoped signed URLs.
- **Insurance catalogues** — admin-configured, and reachable through the back
  office rather than needing a rider screen.

### Deferred

The meter's larger vocabulary is ported and tested but not yet on screen: the
end-of-hire declaration form (passengers, luggage, tolls, airport surcharge),
the trip log and receipt printing from it, operator rate cards
(`meter_digital_settings`), the leave-the-meter popup, odometer capture at
pickup/drop-off, vehicle binding, and meter auto-launch. `welcome-back` passes
`meterAutoLaunch: false` for that reason.

QR pay/scan (`payFromWallet`, `computeCoinSplit`), coin redemption against a
fare at booking time (`redeemCoinsForFare`), payout to a bank account, and the
rate-history chart are all supported by the ported store layer but have no UI
yet.

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

```bash
cp env.example env    # then fill it in
```

`env` is gitignored; `env.example` documents each variable and why it is safe
to ship. Nothing secret belongs there — what protects the data is RLS and the
owner-scoped wallet RPCs, not the anon key.

The Supabase schema is deliberately unchanged — the rebuilt client is written
against the existing project, migrations and RLS policies in `../supabase/`.

## Next

What remains is named under "Not built in Phase 07" above: support voice/video
calls (needs a WebRTC layer) and voice protection (in-ride recording). Beyond
those, the largest open risk remains hardware: the CANBus transports and printer
have never run against a real dongle or printer, and that can only be closed on
a device.
