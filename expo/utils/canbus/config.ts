/** CANBus adapter configuration + tunables. */

/**
 * Default endpoint for a WiFi ELM327 dongle. Virtually all of them boot a
 * soft-AP and expose a raw TCP server at this address; the phone joins that
 * Wi-Fi network and connects here.
 */
export const WIFI_ADAPTER_HOST = "192.168.0.10";
export const WIFI_ADAPTER_PORT = 35000;

/**
 * BLE service/characteristic UUIDs used by the common ELM327 clones
 * (the "IOS-Vlink" / VGate style modules). Some modules instead expose the
 * Nordic UART service or an HM-10 style single characteristic; all of them
 * are probed by the transport, in the order listed in {@link BLE_ELM_PROFILES}.
 */
export const BLE_ELM_SERVICE = "0000FFF0-0000-1000-8000-00805F9B34FB";
export const BLE_ELM_WRITE_CHAR = "0000FFF2-0000-1000-8000-00805F9B34FB";
export const BLE_ELM_NOTIFY_CHAR = "0000FFF1-0000-1000-8000-00805F9B34FB";
export const BLE_NAME_HINTS = ["OBD", "ELM", "VLINK", "VGATE", "ICAR"];

/** One BLE serial profile: the service plus its write/notify characteristics. */
export interface BleElmProfile {
  /** Human name, used in error/debug copy. */
  label: string;
  service: string;
  write: string;
  notify: string;
}

/**
 * Known ELM327-over-BLE serial profiles, most common first. The transport
 * walks this list against the peripheral's discovered services and falls back
 * to "any service exposing a writable + notifiable characteristic" when a
 * clone uses UUIDs nobody has catalogued.
 */
export const BLE_ELM_PROFILES: BleElmProfile[] = [
  {
    label: "ELM327 (FFF0)",
    service: BLE_ELM_SERVICE,
    write: BLE_ELM_WRITE_CHAR,
    notify: BLE_ELM_NOTIFY_CHAR,
  },
  {
    label: "HM-10 serial (FFE0)",
    service: "0000FFE0-0000-1000-8000-00805F9B34FB",
    write: "0000FFE1-0000-1000-8000-00805F9B34FB",
    notify: "0000FFE1-0000-1000-8000-00805F9B34FB",
  },
  {
    label: "Nordic UART",
    service: "6E400001-B5A3-F393-E0A9-E50E24DCCA9E",
    write: "6E400002-B5A3-F393-E0A9-E50E24DCCA9E",
    notify: "6E400003-B5A3-F393-E0A9-E50E24DCCA9E",
  },
];

/**
 * Apple External-Accessory protocol strings for MFi-certified ELM327 dongles.
 *
 * iOS only hands an app the accessories whose protocol string it declares in
 * `UISupportedExternalAccessoryProtocols` (see `expo/app.json`), so this list
 * and that Info.plist array must stay in step — an accessory missing from
 * either one is invisible to the app no matter how it is paired. Only strings
 * published by the accessory vendor belong here; guessing one silently yields
 * a dongle that never appears.
 */
export const MFI_ACCESSORY_PROTOCOLS = ["com.obdlink"];

/**
 * Name fragments that identify a paired accessory as an OBD-II reader. MFi
 * dongles are paired in iOS Settings under their marketing name, so the BLE
 * hints apply here too, plus the MFi-only vendor names.
 */
export const MFI_NAME_HINTS = [...BLE_NAME_HINTS, "SCANTOOL", "STN"];

/** How long to wait for iOS to enumerate the paired accessories, in ms. */
export const MFI_DISCOVERY_TIMEOUT_MS = 8000;

/** How often to poll the vehicle for a fresh telemetry sweep, in ms. */
export const POLL_INTERVAL_MS = 1000;

/** Per-command response timeout, in ms. */
export const COMMAND_TIMEOUT_MS = 4000;

/** Timeout for the whole connect+handshake, in ms. */
export const CONNECT_TIMEOUT_MS = 15000;

/** How long to look for an ELM327 peripheral before giving up, in ms. */
export const BLE_SCAN_TIMEOUT_MS = 12000;

/**
 * How long to wait for the Bluetooth radio to report `PoweredOn` after the
 * manager is created — iOS reports `Unknown` for a moment on every launch.
 */
export const BLE_POWER_ON_TIMEOUT_MS = 6000;

/**
 * Development simulator. When enabled and no real transport is available,
 * useCanbus streams plausible fake telemetry so the panel can be exercised
 * in Expo Go / on the web without hardware. It is reported honestly via
 * `simulated: true` and gated behind the admin "mock" simulation flags —
 * never treated as a live vehicle link.
 */
export const SIMULATOR_TRANSPORT_KIND = "bluetooth" as const;
