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
| `expo/utils/canbus/types.ts` | Shared types: `CanTransportKind` (`wifi`/`bluetooth`/`usb`), `CanDeviceInfo`, `CanConnectionState`, the `CanTransport` interface. |
| `expo/utils/canbus/config.ts` | Adapter defaults (Wi-Fi host/port, BLE UUIDs), poll/timeout tunables. |
| `expo/utils/canbus/transports.ts` | Wi-Fi (TCP), Bluetooth (BLE), and USB-serial transport implementations + availability detection. |
| `expo/utils/canbus/canbusClient.ts` | ELM327 session: runs the handshake, detects the CAN protocol, polls PIDs, emits decoded telemetry. Transport-blind. |
| `expo/utils/canbus/simulator.ts` | Dev-only fake telemetry stream (honestly flagged `simulated: true`). |
| `expo/hooks/useCanbus.ts` | React hook exposing live connection state + `connect`/`disconnect`, with a simulator fallback. |
| `expo/utils/__tests__/obd.test.ts` | Unit tests for the protocol layer (`bun run test utils/__tests__/obd.test.ts`). |

### UI consumption

- **System Status modal** — the `canbus` row now shows the live transport and
  device (e.g. `Wi-Fi · 192.168.0.10:35000` or `Bluetooth · Vgate iCar Pro`),
  the negotiated CAN protocol/bitrate, and a live telemetry grid
  (speed, RPM, coolant, voltage, fuel…). A "Vehicle link (CANBus)" control
  block lets the driver Connect / Disconnect / Retry and shows which transports
  this build supports.
- **Speed pill** — a small header pill shows current speed. It is **green** when
  the value comes from the CANBus link and **blue** when it falls back to the
  device GPS (`expo-location` `coords.speed`, converted m/s → km/h).

## Supported PIDs

`OBD_PIDS` in `obd.ts`: engine RPM (`0C`), vehicle speed (`0D`), coolant temp
(`05`), engine load (`04`), throttle (`11`), fuel level (`2F`), control-module
voltage (`42`), intake air temp (`0F`). Add more by extending that table with a
`decode` function — the poll loop and telemetry UI pick them up automatically.

## Hardware options

| Transport | Adapter example | Pairing | Notes |
| --- | --- | --- | --- |
| **Wi-Fi** | WiFi ELM327 (e.g. "OBDLink MX+ WiFi", generic ELM327 WiFi) | Phone joins the dongle's soft-AP, app connects to `192.168.0.10:35000` | Simplest, no OS pairing. Recommended default. |
| **Bluetooth** | BLE ELM327 (Vgate iCar Pro BLE, "IOS-Vlink") | BLE scan by name hint (`OBD`/`ELM`/`VGATE`…) | Use **BLE** (not classic SPP) modules on iOS — classic Bluetooth SPP is not accessible without MFi. |
| **USB** | USB-serial ELM327 (FTDI/CH340) | Android USB-host only | No supported iOS path. |

Defaults (host/port, BLE service/characteristic UUIDs, name hints) live in
`config.ts` and can be overridden per fleet if needed.

## Making it run on a device (native build)

The transports depend on native modules that are **not** in `package.json` and
are **not** available in Expo Go. Until they are installed the app runs fine and
the panel reports the transport as unavailable / shows the GPS-blue speed pill.
To enable real hardware:

1. Add the optional native deps (only the transports you need):

   ```bash
   cd expo
   bun add react-native-tcp-socket        # Wi-Fi
   bun add react-native-ble-plx           # Bluetooth
   bun add react-native-usb-serialport-for-android   # USB (Android)
   ```

2. Add config plugins / permissions in `expo/app.json`:
   - `react-native-ble-plx` config plugin (adds `NSBluetoothAlwaysUsageDescription`,
     Android `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT`).
   - iOS local-network usage description for Wi-Fi TCP
     (`NSLocalNetworkUsageDescription`).

3. Build a **custom dev client** (these modules can't run in Expo Go):

   ```bash
   bunx expo prebuild
   bunx expo run:android   # or run:ios
   ```

4. Plug in / pair the adapter and open the partner Teksi screen → System Status →
   **Connect adapter**.

The module names are resolved with guarded `require`s, so none of the above is
required just to compile — `getTransportAvailability()` simply reports each
transport's `available`/`reason` and the UI degrades gracefully.

## Simulator

When no real transport is available **and** the admin
`partnerDriveSimEnabled` flag (Admin → Settings → Mock) is on, `useCanbus`
streams plausible fake telemetry so the panel and speed pill can be demoed in
Expo Go / on web. It is always surfaced honestly (`simulated: true`, the detail
line reads `linked (sim)`) and is never presented as a live vehicle link.
