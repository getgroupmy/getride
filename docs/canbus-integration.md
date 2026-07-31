# CANBus / OBD-II vehicle link

The Teksi partner screen (`expo/app/partner-teksi.tsx`) shows a **System Status**
panel and a header **speed pill**. Historically the CANBus row there was
hard-coded demo data (`"500 kbps · linked"`). This document describes the real
OBD-II integration that now backs it, and the hardware / native build steps
required to make it talk to a vehicle.

## What "CANBus" means here

Consumer vehicles expose their ECU telemetry on a CAN bus reachable through the
standard **OBD-II** diagnostic port. Phones/tablets don't have a CAN
transceiver, so a **dongle** bridges OBD-II ↔ the phone over Wi-Fi, Bluetooth,
or USB. Virtually all of these dongles speak the **ELM327** command set
(AT commands + mode-01 PID requests). The app therefore talks ELM327, not raw
CAN framing — the dongle handles the CAN PHY/MAC and protocol negotiation.

## Code layout

All transport-agnostic logic is pure and unit-tested; the native bits are
isolated behind guarded requires so the app still builds and runs without them.

| File | Responsibility |
| --- | --- |
| `expo/utils/canbus/obd.ts` | ELM327 init sequence, OBD-II PID table, command builders, response parsing/decoders, protocol naming. Pure. |
| `expo/utils/canbus/types.ts` | Shared types: `CanTransportKind` (`wifi`/`bluetooth`/`mfi`/`usb`), `CanDeviceInfo`, `CanConnectionState`, the `CanTransport` interface. |
| `expo/utils/canbus/config.ts` | Adapter defaults (Wi-Fi host/port, BLE serial profiles, MFi accessory protocols/name hints), poll/timeout tunables. |
| `expo/utils/canbus/wifi.ts` | Pure Wi-Fi helpers: availability copy for the TCP transport. |
| `expo/utils/canbus/ble.ts` | Pure BLE helpers: UUID normalisation, ELM327 advertisement matching, serial-profile (write/notify characteristic) selection, availability copy. |
| `expo/utils/canbus/mfi.ts` | Pure MFi helpers: accessory-key normalisation, paired-accessory selection, failure/availability copy. |
| `expo/utils/canbus/tcpModule.ts` (+ `.web.ts`) | The single `react-native-tcp-socket` entry point — loads the package behind a guard (it builds a `NativeEventEmitter` at import time) and reports whether `TcpSockets` is linked into this binary. |
| `expo/utils/canbus/bleModule.ts` (+ `.web.ts`) | The single `react-native-ble-plx` entry point — loads the package and reports whether its native side is linked. The web override keeps it out of the browser bundle. |
| `expo/utils/canbus/mfiModule.ts` (+ `.web.ts`) | The same for `react-native-bluetooth-classic` (Bluetooth MFi): loads the package and reports whether `RNBluetoothClassic` is linked into this binary. |
| `expo/utils/canbus/transports.ts` | Wi-Fi (TCP), Bluetooth LE (GATT), Bluetooth MFi (External Accessory), and USB-serial transport implementations + availability detection. |
| `expo/utils/canbus/canbusClient.ts` | ELM327 session: runs the handshake, detects the CAN protocol, polls PIDs, emits decoded telemetry. Transport-blind. |
| `expo/utils/canbus/simulator.ts` | Dev-only fake telemetry stream (honestly flagged `simulated: true`). |
| `expo/utils/canbusAdapterStore.ts` | The driver's saved readers: draft validation, de-duplication, selection, AsyncStorage persistence. Device-local. |
| `expo/hooks/useCanbus.ts` | React hook exposing live connection state + `connect`/`disconnect`, the saved-reader list, and a simulator fallback. |
| `expo/hooks/useIsPartner.ts` | Read-only "is this rider also a partner?" check that gates the user-side reader screen. |
| `expo/app/obd2-reader.tsx` | Settings → OBD-II (CANBus) reader: add / select / remove readers, connect, live telemetry. |
| `expo/utils/__tests__/obd.test.ts` | Unit tests for the protocol layer (`bun run test utils/__tests__/obd.test.ts`). |
| `expo/utils/__tests__/wifi.test.ts` | Unit tests for the Wi-Fi availability rules. |
| `expo/utils/__tests__/ble.test.ts` | Unit tests for the BLE helpers (scan matching, profile selection, availability). |
| `expo/utils/__tests__/mfi.test.ts` | Unit tests for the MFi helpers (accessory matching, availability). |
| `expo/utils/__tests__/canbusAdapterStore.test.ts` | Unit tests for the saved-reader logic. |

### UI consumption

- **System Status modal** — the `canbus` row now shows the live transport and
  device (e.g. `Wi-Fi · 192.168.0.10:35000` or `Bluetooth LE · Vgate iCar Pro`),
  the negotiated CAN protocol/bitrate, and a live telemetry grid
  (speed, RPM, coolant, voltage, fuel…). A "Vehicle link (CANBus)" control
  block lets the driver Connect / Disconnect / Retry and shows which transports
  this build supports. Its connection picker lists Wi-Fi, Bluetooth LE,
  Bluetooth MFi (iOS), USB (Android) and Demo Mode — each row wired to the
  matching transport.
- **Speed pill** — a small header pill shows current speed. It is **green** when
  the value comes from the CANBus link and **blue** when it falls back to the
  device GPS (`expo-location` `coords.speed`, converted m/s → km/h).
- **Settings → OBD-II (CANBus) reader** — the user-side setup screen, described
  below.

## Adding a reader from user settings

A driver sets the dongle up once, from the ordinary rider-side Settings screen.
The row **"OBD-II (CANBus) reader"** appears there only when the signed-in
account is *also* a partner (`useIsPartner` → a `partners` row for this
`auth_user_id` that has picked at least one partner type or cleared its
documents check — the stub row `findOrCreatePartner` writes on a stray
"Partner mode" tap does not count). The row's value shows the selected reader,
e.g. `Wi-Fi · 192.168.0.10:35000`, or `Not set up`.

`app/obd2-reader.tsx` is the screen behind it:

- **Add reader** — pick the connection (Wi-Fi / Bluetooth LE, plus Bluetooth MFi
  on iOS and USB on Android), name it, and fill in the one detail that transport
  needs: for Wi-Fi the dongle's `host` + `port` (pre-filled with the
  near-universal `192.168.0.10:35000`), for MFi the accessory's paired name
  (optional — blank means "the first paired OBD-II accessory"). Drafts are
  validated by `normalizeAdapterDraft`; re-adding the same endpoint or the same
  paired accessory updates the existing entry rather than stacking duplicates.
- **Select / remove** — tap a reader to make it the default, trash-icon (or long
  press) to remove it. Only the entry is removed; the hardware is untouched.
- **Connect / Disconnect** and a live telemetry grid, plus a **Demo Mode**
  button that appears only when the admin `partnerDriveSimEnabled` flag is on.
- **Supported connections** — an honest per-transport availability list, so a
  driver sees *why* a real link can't be attempted instead of a silent failure,
  phrased for the build they are actually on (Expo Go vs. an installed build
  that predates the transport).

Readers are stored **device-local** in AsyncStorage (`@canbus_adapters_v1`,
`@canbus_selected_adapter_v1`) — a dongle belongs to one phone, so no migration
or Supabase table is involved. `useCanbus` loads the selection before
auto-connecting, so the partner Teksi / e-hailing screens link to the reader
configured here, using its saved Wi-Fi endpoint.

## Supported PIDs

`OBD_PIDS` in `obd.ts`: engine RPM (`0C`), vehicle speed (`0D`), coolant temp
(`05`), engine load (`04`), throttle (`11`), fuel level (`2F`), control-module
voltage (`42`), intake air temp (`0F`). Add more by extending that table with a
`decode` function — the poll loop and telemetry UI pick them up automatically.

## Hardware options

| Transport | Adapter example | Pairing | Notes |
| --- | --- | --- | --- |
| **Wi-Fi** | WiFi ELM327 (e.g. "OBDLink MX+ WiFi", generic ELM327 WiFi) | Phone joins the dongle's soft-AP, app connects to `192.168.0.10:35000` | Simplest, no OS pairing. Recommended default. |
| **Bluetooth LE** | BLE ELM327 (Vgate iCar Pro BLE, "IOS-Vlink") | BLE scan by name hint (`OBD`/`ELM`/`VGATE`…) | Works on both platforms. On iOS a plain classic-SPP dongle is *not* an option — it must be BLE or MFi. |
| **Bluetooth MFi** | MFi-certified classic dongle (OBDLink MX+/LX, STN-based readers) | Paired in iOS Settings → Bluetooth, then opened via the ExternalAccessory framework | iOS only. Needs the accessory's protocol string in `UISupportedExternalAccessoryProtocols`. |
| **USB** | USB-serial ELM327 (FTDI/CH340) | Android USB-host only | No supported iOS path. |

Defaults (host/port, BLE service/characteristic UUIDs, name hints) live in
`config.ts` and can be overridden per fleet if needed.

## Bluetooth (BLE)

`react-native-ble-plx` **is** a dependency of the app, and its Expo config
plugin is registered in `expo/app.json`, so Bluetooth readers work in any build
produced from this repo (dev client, EAS/store build) — nothing extra to
install. What the transport does on connect:

1. **Permissions** — Android 12+ requests `BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT`
   at runtime, Android ≤ 11 requests `ACCESS_FINE_LOCATION` (a BLE scan counts
   as a location fix there). iOS uses the `NSBluetoothAlwaysUsageDescription`
   string the config plugin writes.
2. **Radio state** — waits for `PoweredOn`, with a distinct message for
   "Bluetooth is off", "not allowed", and "no BLE radio" instead of a timeout.
3. **Scan** — accepts the first peripheral whose name matches a hint
   (`OBD`/`ELM`/`VLINK`/`VGATE`/`ICAR`) *or* that advertises a known serial
   service, then always stops the scan (including on the timeout path).
4. **Profile discovery** — walks `BLE_ELM_PROFILES` (ELM327 `FFF0`, HM-10
   `FFE0`, Nordic UART) against the peripheral's GATT tree, falling back to the
   first non-standard service exposing a writable + notifiable characteristic,
   so uncatalogued clones still link. Writes use with/without-response
   according to the characteristic's own flags.

The matching, UUID-normalising and profile-picking logic is pure and lives in
`utils/canbus/ble.ts` (unit tested); only `transports.ts` touches the manager.

### When the native module is missing

BLE only works in a binary that was **prebuilt with the `react-native-ble-plx`
config plugin**. Two different builds can be missing it, and they need opposite
advice, so `describeMissingNativeModule` (`utils/canbus/availability.ts`) phrases
the answer from `getAppRuntime()` rather than from which half is absent:

| Runtime | What's missing | What the driver is told |
| --- | --- | --- |
| Expo Go | the native side (`NativeModules.BlePlx`); the JS loads | *"needs a development or production build (not available in Expo Go)"* |
| Installed build (TestFlight / App Store / dev client) | usually **both** — the binary was compiled before the dependency existed, so `require("react-native-ble-plx")` fails too | *"not included in this build of the app"* + install the latest build |

That second row is the one that bites: a TestFlight build cut before the BLE
work shipped reports Bluetooth as unavailable no matter what the driver does,
and no OTA JS update can fix it — **BLE support requires a new native build**
(`eas build -p ios --profile production` → submit → new TestFlight build).

Availability entries carry both a short `reason` (list rows) and a longer
`guidance` string (alerts), so no screen hardcodes build-specific copy.

`isBleNativeLinked()` checks `NativeModules.BlePlx` *and*
`TurboModuleRegistry.get("BlePlx")`: the app runs the New Architecture, where
this legacy module is reached through the TurboModule interop, and a single
lookup could report "unavailable" in a build that actually has BLE.

To use real hardware from a local checkout, build a dev client:

```bash
cd expo
bunx expo prebuild
bunx expo run:android   # or run:ios
```

## Bluetooth MFi (Apple External Accessory)

MFi is the *other* Bluetooth family, and the reason it needs a transport of its
own rather than a flag on the BLE one: an MFi dongle is a **classic-Bluetooth
(SPP)** device carrying Apple's authentication coprocessor. iOS never exposes it
over a socket or a GATT scan — the app reaches it only through the
**ExternalAccessory** framework, and only when three things line up:

1. The driver has paired the adapter in **iOS Settings → Bluetooth** (the exact
   opposite of the BLE rule, where pairing in Settings breaks the scan).
2. The app declares the accessory's protocol string in
   `UISupportedExternalAccessoryProtocols` (`expo/app.json` → `ios.infoPlist`),
   mirrored by `MFI_ACCESSORY_PROTOCOLS` in `config.ts`. Only strings published
   by the accessory vendor work — a guessed one yields an adapter that never
   appears. `com.obdlink` (ScanTool's OBDLink MX+/LX) ships by default; add the
   vendor's string to **both** lists for any other certified dongle.
3. The native module is in the binary. `react-native-bluetooth-classic` is a
   real dependency, so this holds for any build prebuilt since it shipped — but
   *not* for a TestFlight/App Store build made before that, which needs a new
   native build rather than an OTA update. `mfiModule.ts` checks for the linked
   `RNBluetoothClassic` module (not merely for the JS package, which always
   resolves) so the app can say which of the two is missing.

Two details of the accessory session are easy to get wrong and are pinned down
by `mfiConnectionOptions` in `mfi.ts`:

- **`charset` must be a number.** iOS reads the option as
  `value as! CFStringEncoding` — a `UInt32` force-cast — so passing the name of
  an encoding (`"ascii"`) crashes the app the moment a driver taps Connect. The
  value sent is `CFStringBuiltInEncodings.isoLatin1`, chosen over strict ASCII
  because every byte decodes: one noise byte above 0x7F would make an ASCII
  decode return nil and drop the whole read.
- **Writes go in as plain text.** The library's `writeToDevice` already does
  `Buffer.from(text, encoding).toString("base64")` before the native call, so
  base64-encoding first sends the dongle a double-encoded command it can only
  answer with `?`.

Android is not autolinked for this package (`expo/react-native.config.js`): MFi
is iOS-only by design, and the library's `android/build.gradle` still compiles
against `com.facebook.react:react-native:0.71.0-rc.0` with an AGP 3.4
buildscript, which has no business in an RN 0.81 / Expo SDK 54 build.

Because iOS can hand back several paired accessories, a saved MFi reader may
carry a **paired name** (`SavedCanAdapter.accessory`). Left blank the transport
takes the first paired accessory whose name matches a reader hint
(`OBD`/`ELM`/`SCANTOOL`/`STN`…); filled in, only that accessory is acceptable —
`pickMfiAccessory` never silently falls back to a different dongle, since that
would stream another vehicle's telemetry. The matching and the failure copy are
pure and unit tested in `utils/canbus/mfi.ts`.

Framing differs from the other transports: the session client reads a response
as everything up to the ELM327 prompt, so the MFi stream is delimited on `>`
rather than on CR. A CR delimiter would strand the trailing prompt — the ELM327
does not terminate it — and every command would time out.

On Android the same dongles are reachable over plain SPP with no certification
involved, so the MFi row is hidden there and `describeMfiAvailability` points
the driver at Bluetooth LE / USB instead.

## Making USB run on a device (native build)

Wi-Fi (`react-native-tcp-socket`), Bluetooth LE (`react-native-ble-plx`) and
Bluetooth MFi (`react-native-bluetooth-classic`) are installed dependencies —
they need a native build, not a package install. A build made *before* one of
them landed cannot use that transport at all, and no OTA update will change
that; `describeMissingNativeModule` says so in the runtime's own terms.

USB still depends on a native module that is **not** in `package.json`; until
it is installed the app runs fine and the panel reports USB as unavailable. To
enable it:

1. Add the optional native dep:

   ```bash
   cd expo
   bun add react-native-usb-serialport-for-android   # USB (Android)
   ```

2. Swap its `null` entry in `OPTIONAL_MODULES` (`transports.ts`) for a guarded
   static `require("<module-name>")` — Metro cannot bundle a dynamic
   `require(name)`.

3. Prebuild and run a dev client as above, then plug in the adapter and open
   the partner Teksi screen → System Status → **Connect adapter**.

That module name is resolved through a guarded lookup, so none of the above is
required just to compile — `getTransportAvailability()` simply reports each
transport's `available`/`reason` and the UI degrades gracefully.

A `null` entry is indistinguishable from "no such build exists", which is how
Wi-Fi ended up telling TestFlight drivers to install a newer build that could
never have contained the driver. Promoting a transport out of `OPTIONAL_MODULES`
means: a real dependency, an entry-point module reporting "package resolves" and
"native module linked" separately, a null `.web.ts` override, and pure
availability rules that a unit test can pin down.

### Wi-Fi specifics

- **iOS local network.** A Wi-Fi ELM327 runs its own soft-AP, so the socket to
  `192.168.0.10:35000` is local-network traffic. iOS 14+ blocks it outright
  without `NSLocalNetworkUsageDescription` in `expo/app.json` — the driver never
  even sees a permission prompt, just a connect timeout.
- **Guarded require.** `react-native-tcp-socket/src/Globals.js` runs
  `new NativeEventEmitter(NativeModules.TcpSockets)` at *import* time. Without
  the native module that argument is null, which RN rejects with an invariant,
  so an unguarded top-level import would take down the reader screen instead of
  reporting Wi-Fi as unavailable. `tcpModule.ts` owns that guard.
- **Autolinking.** Unlike `react-native-bluetooth-classic`, no platform needs
  excluding: the library's `android/build.gradle` resolves React Native through
  `safeExtGet` + a dynamic version, so it picks up the host project's SDK and
  RNGP's `react-native` → `react-android` substitution.

## Simulator

When no real transport is available **and** the admin
`partnerDriveSimEnabled` flag (Admin → Settings → Mock) is on, `useCanbus`
streams plausible fake telemetry so the panel and speed pill can be demoed in
Expo Go / on web. It is always surfaced honestly (`simulated: true`, the detail
line reads `linked (sim)`) and is never presented as a live vehicle link.
