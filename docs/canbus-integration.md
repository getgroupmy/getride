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
| `expo/utils/canbus/ble.ts` | Pure BLE helpers: UUID normalisation, ELM327 advertisement matching, serial-profile (write/notify characteristic) selection, availability copy. |
| `expo/utils/canbus/mfi.ts` | Pure MFi helpers: accessory-key normalisation, paired-accessory selection, failure/availability copy. |
| `expo/utils/canbus/bleModule.ts` (+ `.web.ts`) | The single `react-native-ble-plx` entry point — loads the package and reports whether its native side is linked. The web override keeps it out of the browser bundle. |
| `expo/utils/canbus/transports.ts` | Wi-Fi (TCP), Bluetooth LE (GATT), Bluetooth MFi (External Accessory), and USB-serial transport implementations + availability detection. |
| `expo/utils/canbus/canbusClient.ts` | ELM327 session: runs the handshake, detects the CAN protocol, polls PIDs, emits decoded telemetry. Transport-blind. |
| `expo/utils/canbus/simulator.ts` | Dev-only fake telemetry stream (honestly flagged `simulated: true`). |
| `expo/utils/canbusAdapterStore.ts` | The driver's saved readers: draft validation, de-duplication, selection, AsyncStorage persistence. Device-local. |
| `expo/hooks/useCanbus.ts` | React hook exposing live connection state + `connect`/`disconnect`, the saved-reader list, and a simulator fallback. |
| `expo/hooks/useIsPartner.ts` | Read-only "is this rider also a partner?" check that gates the user-side reader screen. |
| `expo/app/obd2-reader.tsx` | Settings → OBD-II (CANBus) reader: add / select / remove readers, connect, live telemetry. |
| `expo/utils/__tests__/obd.test.ts` | Unit tests for the protocol layer (`bun run test utils/__tests__/obd.test.ts`). |
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
  driver on Expo Go sees *why* a real link can't be attempted instead of a
  silent failure.

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

**Expo Go**: the JS loads but the `BlePlx` native module isn't in that binary,
so the panel reports *"needs a development or production build (not available
in Expo Go)"* rather than failing mid-connect. Build a dev client to use real
hardware:

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
3. The native module is in the binary (see below).

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

## Making Wi-Fi / MFi / USB run on a device (native build)

Those three transports still depend on native modules that are **not** in
`package.json`. Until they are installed the app runs fine and the panel reports
them as unavailable / shows the GPS-blue speed pill. To enable them:

1. Add the optional native deps (only the transports you need):

   ```bash
   cd expo
   bun add react-native-tcp-socket        # Wi-Fi
   bun add react-native-bluetooth-classic # Bluetooth MFi (iOS)
   bun add react-native-usb-serialport-for-android   # USB (Android)
   ```

2. Swap the matching `null` entry in `OPTIONAL_MODULES` (`transports.ts`) for a
   guarded static `require("<module-name>")` — Metro cannot bundle a dynamic
   `require(name)`.

3. Add the iOS local-network usage description for Wi-Fi TCP
   (`NSLocalNetworkUsageDescription`) in `expo/app.json`.

4. Prebuild and run a dev client as above, then plug in / pair the adapter and
   open the partner Teksi screen → System Status → **Connect adapter**.

Those module names are resolved through a guarded lookup, so none of the above
is required just to compile — `getTransportAvailability()` simply reports each
transport's `available`/`reason` and the UI degrades gracefully.

## Simulator

When no real transport is available **and** the admin
`partnerDriveSimEnabled` flag (Admin → Settings → Mock) is on, `useCanbus`
streams plausible fake telemetry so the panel and speed pill can be demoed in
Expo Go / on web. It is always surfaced honestly (`simulated: true`, the detail
line reads `linked (sim)`) and is never presented as a live vehicle link.
