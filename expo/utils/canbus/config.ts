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
 * (the "IOS-Vlink" / VGate style modules). Some modules also expose the
 * Nordic UART service; both are probed by the transport.
 */
export const BLE_ELM_SERVICE = "0000FFF0-0000-1000-8000-00805F9B34FB";
export const BLE_ELM_WRITE_CHAR = "0000FFF2-0000-1000-8000-00805F9B34FB";
export const BLE_ELM_NOTIFY_CHAR = "0000FFF1-0000-1000-8000-00805F9B34FB";
export const BLE_NAME_HINTS = ["OBD", "ELM", "VLINK", "VGATE", "ICAR"];

/** How often to poll the vehicle for a fresh telemetry sweep, in ms. */
export const POLL_INTERVAL_MS = 1000;

/** Per-command response timeout, in ms. */
export const COMMAND_TIMEOUT_MS = 4000;

/** Timeout for the whole connect+handshake, in ms. */
export const CONNECT_TIMEOUT_MS = 15000;

/**
 * Development simulator. When enabled and no real transport is available,
 * useCanbus streams plausible fake telemetry so the panel can be exercised
 * in Expo Go / on the web without hardware. It is reported honestly via
 * `simulated: true` and gated behind the admin "mock" simulation flags —
 * never treated as a live vehicle link.
 */
export const SIMULATOR_TRANSPORT_KIND = "bluetooth" as const;
